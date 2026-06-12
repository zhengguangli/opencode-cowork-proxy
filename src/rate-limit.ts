/**
 * Client-side rate-limit awareness module.
 *
 * WHEN TO READ THIS FILE: Understanding how upstream rate limits are tracked,
 * adding proactive throttle logic, or debugging rate-limit header forwarding.
 *
 * Tracks rate-limit headers from upstream responses and provides utilities
 * for the proxy to make informed throttling decisions. Does NOT enforce
 * hard rate limits (that's the upstream's job) — it surfaces data that
 * downstream clients and monitoring can use.
 *
 * Rate-limit headers tracked (per upstream):
 *   - RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset
 *   - X-RateLimit-Limit-Requests, X-RateLimit-Limit-Tokens
 */

import { log } from './logger';

interface RateLimitState {
  /** Last known limit */
  limit: number;
  /** Last known remaining requests */
  remaining: number;
  /** Last known reset timestamp (Unix seconds) */
  reset: number;
  /** When this state was last updated */
  lastUpdated: number;
  /** Upstream URL */
  upstream: string;
}

const stateMap = new Map<string, RateLimitState>();

/**
 * Extract rate-limit headers from an upstream response and update tracking state.
 * Returns the extracted headers so callers can forward them to the client.
 */
export function trackRateLimits(upstream: string, response: Response | Headers): Record<string, string> {
  const headers = response instanceof Response ? response.headers : response;
  const result: Record<string, string> = {};

  const limit = headers.get('RateLimit-Limit');
  const remaining = headers.get('RateLimit-Remaining');
  const reset = headers.get('RateLimit-Reset');
  const reqLimit = headers.get('X-RateLimit-Limit-Requests');
  const tokenLimit = headers.get('X-RateLimit-Limit-Tokens');

  if (limit) result['RateLimit-Limit'] = limit;
  if (remaining) result['RateLimit-Remaining'] = remaining;
  if (reset) result['RateLimit-Reset'] = reset;
  if (reqLimit) result['X-RateLimit-Limit-Requests'] = reqLimit;
  if (tokenLimit) result['X-RateLimit-Limit-Tokens'] = tokenLimit;

  if (remaining && limit && reset) {
    const parsed = {
      limit: parseInt(limit, 10),
      remaining: parseInt(remaining, 10),
      reset: parseInt(reset, 10),
    };

    if (!isNaN(parsed.limit) && !isNaN(parsed.remaining) && !isNaN(parsed.reset)) {
      const prev = stateMap.get(upstream);
      stateMap.set(upstream, {
        ...parsed,
        lastUpdated: Date.now(),
        upstream,
      });

      // Warn if remaining is critically low
      if (parsed.remaining < 5 && parsed.limit > 0) {
        log.warn('RATELIMIT', `Upstream ${upstream} low on quota: ${parsed.remaining}/${parsed.limit} remaining, resets at ${new Date(parsed.reset * 1000).toISOString()}`);
      }
    }
  }

  return result;
}

/**
 * Get the current rate-limit state for an upstream.
 * Returns null if no rate-limit headers have been observed yet.
 */
export function getRateLimitState(upstream: string): RateLimitState | null {
  return stateMap.get(upstream) ?? null;
}

/**
 * Check if the upstream is likely throttled based on observed rate-limit headers.
 * Returns true if remaining is 0 or past data suggests the upstream is under pressure.
 *
 * This is advisory only — the upstream may have different rate-limit windows
 * or per-key limits that we can't observe.
 */
export function isUpstreamThrottled(upstream: string): boolean {
  const state = stateMap.get(upstream);
  if (!state) return false;

  // If remaining is 0 and we haven't passed the reset window, assume throttled
  if (state.remaining <= 0 && Date.now() < state.reset * 1000) {
    return true;
  }

  // If remaining is critically low (< 5% of limit), warn but don't block
  return false;
}

/**
 * Calculate the recommended delay in ms before the next request (advisory).
 * Returns 0 if no throttling is needed.
 */
export function recommendThrottleDelay(upstream: string): number {
  const state = stateMap.get(upstream);
  if (!state || state.limit <= 0) return 0;

  // If we're at 0 remaining, wait until the reset window
  if (state.remaining <= 0) {
    const waitMs = Math.max(0, state.reset * 1000 - Date.now());
    return Math.min(waitMs, 60_000); // Cap at 60s
  }

  // In the last 20% of quota, spread requests out
  const ratio = state.remaining / state.limit;
  if (ratio < 0.2) {
    // Suggest a small delay to avoid hitting the limit
    const windowRemaining = Math.max(1, state.reset * 1000 - Date.now());
    const delayPerRequest = windowRemaining / state.remaining;
    return Math.min(delayPerRequest, 5_000); // Cap at 5s per request
  }

  return 0;
}

/**
 * Reset rate-limit tracking (useful for testing or upstream changes).
 */
export function resetRateLimitTracking(upstream?: string): void {
  if (upstream) {
    stateMap.delete(upstream);
  } else {
    stateMap.clear();
  }
}
