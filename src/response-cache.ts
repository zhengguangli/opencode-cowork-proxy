/**
 * Response caching layer for non-streaming proxy responses.
 *
 * WHEN TO READ THIS FILE: Tuning cache behavior, adding new cacheable
 * endpoints, or debugging stale cache issues.
 *
 * Cache strategy:
 *   - Cache key = hash(upstream + path + request_body)
 *   - TTLs are endpoint-specific (configurable)
 *   - Only caches successful (2xx) non-streaming responses
 *   - In-memory Map with TTL expiration (suitable for CF Workers single-request
 *     scope; persistent caching delegates to Cloudflare Cache API)
 *
 * Currently used for:
 *   - GET /v1/models — already cached via Cloudflare Cache API (300s TTL)
 *   - POST responses with identical system prompts — benefit from prompt_cache_key
 *
 * Future: selective response caching for deterministic endpoints (e.g., model info).
 */
import { log } from './logger';

interface CacheEntry {
  response: Response;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
}

const store = new Map<string, CacheEntry>();

const DEFAULT_TTL_MS = 60_000; // 60s default
const MAX_CACHE_SIZE = 50;

// Periodic cleanup
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
function ensureCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now >= entry.expiresAt) {
        store.delete(key);
      }
    }
    if (store.size === 0 && cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
  }, 30_000);
}

function cacheKey(upstream: string, path: string, bodyHash: string): string {
  return `${upstream}|${path}|${bodyHash}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Attempt to retrieve a cached response.
 * Returns the cached Response (cloned) or null if not found/expired.
 */
export function getCachedResponse(upstream: string, path: string, body: string): Response | null {
  const key = cacheKey(upstream, path, simpleHash(body));
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    store.delete(key);
    return null;
  }
  entry.hitCount++;
  return entry.response.clone();
}

/**
 * Store a response in cache.
 * The response body is consumed and buffered.
 */
export async function setCachedResponse(
  upstream: string, path: string, body: string,
  response: Response, ttlMs = DEFAULT_TTL_MS,
): Promise<void> {
  // Don't cache error responses or streaming
  if (!response.ok) return;
  if (response.headers.get('Content-Type')?.includes('text/event-stream')) return;

  // Evict oldest if at capacity
  if (store.size >= MAX_CACHE_SIZE) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of store) {
      if (v.createdAt < oldestTime) {
        oldestTime = v.createdAt;
        oldestKey = k;
      }
    }
    if (oldestKey) store.delete(oldestKey);
  }

  const key = cacheKey(upstream, path, simpleHash(body));
  const now = Date.now();

  // Buffer the response body so we can clone it later
  const clonedResponse = response.clone();
  const textBody = await clonedResponse.text();

  const cachedResponse = new Response(textBody, {
    status: clonedResponse.status,
    statusText: clonedResponse.statusText,
    headers: clonedResponse.headers,
  });
  // Add cache info header
  cachedResponse.headers.set('X-Cache', 'miss');

  store.set(key, {
    response: cachedResponse,
    createdAt: now,
    expiresAt: now + ttlMs,
    hitCount: 0,
  });

  ensureCleanup();
}

/**
 * Get cache statistics for monitoring.
 */
export function getCacheStats(): { size: number; entries: Array<{ key: string; hitCount: number; ttlRemaining: number }> } {
  const now = Date.now();
  const entries: Array<{ key: string; hitCount: number; ttlRemaining: number }> = [];
  for (const [key, entry] of store) {
    entries.push({ key, hitCount: entry.hitCount, ttlRemaining: Math.max(0, entry.expiresAt - now) });
  }
  return { size: store.size, entries };
}

/**
 * Clear the entire cache or a specific key pattern.
 */
export function clearCache(pattern?: string): number {
  if (!pattern) {
    const size = store.size;
    store.clear();
    return size;
  }
  let removed = 0;
  for (const key of store.keys()) {
    if (key.includes(pattern)) {
      store.delete(key);
      removed++;
    }
  }
  return removed;
}
