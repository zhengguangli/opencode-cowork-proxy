/**
 * URL-based routing: path prefix parsing, upstream resolution, model segment extraction.
 *
 * WHEN TO READ THIS FILE: Adding a new path prefix, changing upstream resolution
 * logic, or debugging model-override-from-URL behavior.
 */
import { GO_UPSTREAM, ZEN_UPSTREAM, DEFAULT_UPSTREAM, API_VERSION_PATTERN, UPSTREAM_ALLOWED_HOSTS } from './config';

export type RouteConfig = {
  path: string;
  upstream: string;
  modelOverride: string | null;
};

function stripPrefix(path: string, prefix: string): string | null {
  if (path === prefix) return "/";
  if (path.startsWith(`${prefix}/`)) return path.slice(prefix.length);
  return null;
}

// Reserved path prefixes that should never be consumed as model overrides.
// These are well-known proxy endpoints, not model names.
const RESERVED_NON_MODEL = new Set(['ws', 'health', 'audit', 'metrics']);

function extractModelSegment(path: string): { path: string; model: string | null } {
  const segments = path.replace(/^\/+/, '').split('/');
  if (segments.length > 0 && segments[0] && !API_VERSION_PATTERN.test(segments[0])) {
    // Reserved non-model paths: /ws/v1/messages, /health/upstream, /audit/log, /metrics
    if (RESERVED_NON_MODEL.has(segments[0])) {
      return { path, model: null };
    }
    // Treat first segment as model override when followed by v\d+ API path
    // e.g. /claude-sonnet-4/v1/messages → model=claude-sonnet-4, path=/v1/messages
    if (segments.length >= 2 && API_VERSION_PATTERN.test(segments[1])) {
      return { path: '/' + segments.slice(1).join('/'), model: segments[0] };
    }
    // Standalone model with trailing slash: /deepseek-v4/ → model=deepseek-v4, path=/
    if (segments.length === 2 && segments[1] === '' && segments[0].includes('-')) {
      return { path: '/', model: segments[0] };
    }
    // Standalone model with no trailing slash but looks like a model name
    if (segments.length === 1 && (
      segments[0].includes('-') ||
      /^(gpt|deepseek|qwen|mimo|gemini|claude)/.test(segments[0])
    )) {
      return { path: '/', model: segments[0] };
    }
  }
  return { path, model: null };
}

export function routeConfig(request: Request): RouteConfig {
  const path = new URL(request.url).pathname;
  const goPath = stripPrefix(path, "/go");
  if (goPath) {
    const { path: remaining, model } = extractModelSegment(goPath);
    return { path: remaining, upstream: GO_UPSTREAM, modelOverride: model };
  }

  const zenPath = stripPrefix(path, "/zen");
  if (zenPath) {
    const { path: remaining, model } = extractModelSegment(zenPath);
    return { path: remaining, upstream: ZEN_UPSTREAM, modelOverride: model };
  }

  const { path: remaining, model } = extractModelSegment(path);
  return { path: remaining, upstream: DEFAULT_UPSTREAM, modelOverride: model };
}

/**
 * Hostnames that resolve to the local machine or a non-routable network.
 * Kept as patterns rather than a net module import so this stays a pure
 * utility (routing.ts must not pull in I/O-capable dependencies).
 */
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return true;              // this-host, RFC1918, loopback
  if (a === 169 && b === 254) return true;                         // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;                // RFC1918
  if (a === 192 && b === 168) return true;                         // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true;               // CGNAT
  if (a === 192 && b === 0 && c === 2) return true;                // TEST-NET-1
  if (a >= 224) return true;                                       // multicast + reserved
  return false;
}

/**
 * Rebuild the dotted IPv4 form from the two hex groups of an IPv4-mapped IPv6
 * address. WHATWG URL normalizes `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`,
 * so the dotted form has to be recovered before range checks.
 */
function ipv4FromHexGroups(rest: string): string | null {
  const groups = rest.split(':');
  if (groups.length !== 2) return null;
  const hi = Number.parseInt(groups[0], 16);
  const lo = Number.parseInt(groups[1], 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;

  const v4 = h.match(IPV4_PATTERN);
  if (v4) return isPrivateIpv4([Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4])]);

  if (h.includes(":")) {
    if (h === "::1" || h === "::") return true;                    // loopback / unspecified
    if (/^f[cd]/.test(h)) return true;                             // fc00::/7 unique-local
    if (/^fe[89ab]/.test(h)) return true;                          // fe80::/10 link-local
    if (h.startsWith("::ffff:")) {
      const rest = h.slice(7);
      const mapped = rest.includes(".") ? rest : ipv4FromHexGroups(rest);
      // Fail closed: an unrecognized mapped form is treated as private.
      return mapped ? isPrivateHost(mapped) : true;
    }
    return false;
  }
  return false;
}

/**
 * Decide whether an X-Upstream-Url value may be used as the upstream base.
 *
 * The header is untrusted client input. Left unchecked it turns the
 * deployment into an open relay: any caller holding a well-formed API key
 * could read responses from loopback services, cloud metadata endpoints
 * (169.254.169.254) and internal networks under this deployment's egress.
 *
 * Guards: https only, no loopback/private/link-local/CGNAT/multicast IP
 * literals, no *.localhost hostnames, and - when UPSTREAM_ALLOWED_HOSTS is
 * non-empty - the host must be allowlisted.
 *
 * Note this cannot stop DNS-based redirection (a public name resolving to
 * an internal address); set UPSTREAM_ALLOWED_HOSTS for that.
 */
export function isAllowedUpstreamUrl(value: string, allowedHosts: ReadonlySet<string> = UPSTREAM_ALLOWED_HOSTS): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (isPrivateHost(host)) return false;
  if (allowedHosts.size > 0 && !allowedHosts.has(host)) return false;
  return true;
}

/**
 * Resolve the upstream base URL for a request.
 *
 * The X-Upstream-Url override (used for custom Anthropic-compatible
 * endpoints) is validated by isAllowedUpstreamUrl. A missing, malformed or
 * rejected value falls back to routeUpstream, so a bad header never breaks
 * an otherwise valid request.
 */
export function getUpstream(request: Request, routeUpstream: string, allowedHosts: ReadonlySet<string> = UPSTREAM_ALLOWED_HOSTS): string {
  const header = request.headers.get("X-Upstream-Url")?.trim();
  if (!header) return routeUpstream;
  if (!isAllowedUpstreamUrl(header, allowedHosts)) return routeUpstream;
  return header;
}

export function upstreamFormat(request: Request): "openai" | "anthropic" {
  const fmt = (request.headers.get("X-Upstream-Format") || "openai").toLowerCase();
  return fmt === "anthropic" ? "anthropic" : "openai";
}
