/**
 * Model discovery (with Cloudflare Cache API for 300s TTL).
 *
 * WHEN TO READ THIS FILE: Modifying model list caching behavior, changing cache
 * TTL, or debugging model list auth or proxy behavior.
 *
 * Proxies the upstream /v1/models endpoint with format-aware auth headers
 * and Cloudflare Cache API for efficient caching across requests.
 */

import { anthropicHeaders, authenticateRequest, safeUpstreamFetch, upstreamErrorResponse } from '../request';
import { MODEL_CACHE_TTL, MODEL_LIST_TIMEOUT } from '../config';

import { log } from '../logger';
import { RouteInfo } from './shared';

/**
 * Handle GET /v1/models — model discovery with caching.
 *
 * Proxies the upstream model list, using Cloudflare Cache API for TTL-based
 * caching. The cache key is auth-independent (URL-based only).
 */
export async function handleModelList(
  request: Request,
  route: RouteInfo,
  fmt: string,
): Promise<Response> {
  const auth = authenticateRequest(request, route.path);
  if ('response' in auth) return auth.response;
  const { key } = auth;
  const upstream = route.upstream;

  // Compute cache key from upstream + format (auth-independent, URL-only)
  const cacheRequest = new Request(`${upstream}/v1/models?fmt=${fmt}`, { method: "GET" });
  const modelCache = typeof caches !== "undefined" ? caches.default : null;
  const cached = modelCache ? await modelCache.match(cacheRequest) : null;
  if (cached) return cached;

  const res = fmt === "anthropic"
    ? await safeUpstreamFetch(`${upstream}/v1/models`, {
        method: "GET",
        headers: anthropicHeaders(request, key),
        signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT),
      })
    : await safeUpstreamFetch(`${upstream}/v1/models`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${key}` },
        signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT),
    });
  if (!res.ok) return upstreamErrorResponse(res, await res.text());

  const body = await res.text();
  const response = new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${MODEL_CACHE_TTL}`,
    },
  });
  // Fire-and-forget cache put (no await to avoid blocking response)
  if (modelCache) {
    (async () => { try { await modelCache.put(cacheRequest, response.clone()); } catch (e) { log.debug('MODELS', 'modelCache.put failed', { error: e }); } })();
  }
  return response;
}
