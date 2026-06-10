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

function extractModelSegment(path: string): { path: string; model: string | null } {
  const segments = path.replace(/^\/+/, '').split('/');
  if (segments.length > 0 && segments[0] && !API_VERSION_PATTERN.test(segments[0])) {
    return { path: '/' + segments.slice(1).join('/'), model: segments[0] };
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
