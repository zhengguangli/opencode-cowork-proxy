/**
 * URL-based routing: path prefix parsing, upstream resolution, model segment extraction.
 *
 * WHEN TO READ THIS FILE: Adding a new path prefix, changing upstream resolution
 * logic, or debugging model-override-from-URL behavior.
 */
import { GO_UPSTREAM, ZEN_UPSTREAM, DEFAULT_UPSTREAM, API_VERSION_PATTERN } from './config';

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

export function getUpstream(request: Request, routeUpstream: string): string {
  const header = request.headers.get("X-Upstream-Url")?.trim();
  if (header) {
    try { new URL(header); return header; }
    catch { }
  }
  return routeUpstream;
}

export function upstreamFormat(request: Request): "openai" | "anthropic" {
  const fmt = (request.headers.get("X-Upstream-Format") || "openai").toLowerCase();
  return fmt === "anthropic" ? "anthropic" : "openai";
}
