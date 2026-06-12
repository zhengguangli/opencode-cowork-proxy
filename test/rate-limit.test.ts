import { describe, it, expect, beforeEach } from 'vitest';
import {
  trackRateLimits,
  getRateLimitState,
  isUpstreamThrottled,
  recommendThrottleDelay,
  resetRateLimitTracking,
} from '../src/rate-limit';

const TEST_UPSTREAM = 'https://test.example.com';

beforeEach(() => {
  resetRateLimitTracking();
});

describe('trackRateLimits', () => {
  it('extracts RateLimit headers from Headers object', () => {
    const headers = new Headers({
      'RateLimit-Limit': '100',
      'RateLimit-Remaining': '85',
      'RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
      'X-RateLimit-Limit-Requests': '100',
      'X-RateLimit-Limit-Tokens': '100000',
    });

    const result = trackRateLimits(TEST_UPSTREAM, headers);
    expect(result['RateLimit-Limit']).toBe('100');
    expect(result['RateLimit-Remaining']).toBe('85');
    expect(result['RateLimit-Reset']).toBeDefined();
  });

  it('extracts RateLimit headers from Response object', () => {
    const response = new Response(null, {
      headers: {
        'RateLimit-Limit': '50',
        'RateLimit-Remaining': '30',
        'RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 1800),
      },
    });

    const result = trackRateLimits(TEST_UPSTREAM, response);
    expect(result['RateLimit-Limit']).toBe('50');
    expect(result['RateLimit-Remaining']).toBe('30');
  });

  it('returns empty object when no rate-limit headers present', () => {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    const result = trackRateLimits(TEST_UPSTREAM, headers);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('updates state for the tracked upstream', () => {
    const resetTime = Math.floor(Date.now() / 1000) + 3600;
    trackRateLimits(TEST_UPSTREAM, new Headers({
      'RateLimit-Limit': '100',
      'RateLimit-Remaining': '75',
      'RateLimit-Reset': String(resetTime),
    }));

    const state = getRateLimitState(TEST_UPSTREAM);
    expect(state).not.toBeNull();
    expect(state!.limit).toBe(100);
    expect(state!.remaining).toBe(75);
    expect(state!.reset).toBe(resetTime);
    expect(state!.upstream).toBe(TEST_UPSTREAM);
  });
});

describe('getRateLimitState', () => {
  it('returns null for untracked upstream', () => {
    expect(getRateLimitState('https://untracked.example.com')).toBeNull();
  });

  it('returns state for tracked upstream', () => {
    trackRateLimits(TEST_UPSTREAM, new Headers({
      'RateLimit-Limit': '100',
      'RateLimit-Remaining': '50',
      'RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 600),
    }));

    const state = getRateLimitState(TEST_UPSTREAM);
    expect(state).not.toBeNull();
    expect(state!.remaining).toBe(50);
  });
});

describe('isUpstreamThrottled', () => {
  it('returns false when no state exists', () => {
    expect(isUpstreamThrottled(TEST_UPSTREAM)).toBe(false);
  });

  it('returns false when remaining > 0', () => {
    trackRateLimits(TEST_UPSTREAM, new Headers({
      'RateLimit-Limit': '100',
      'RateLimit-Remaining': '50',
      'RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 600),
    }));
    expect(isUpstreamThrottled(TEST_UPSTREAM)).toBe(false);
  });

  it('returns true when remaining is 0 and window not expired', () => {
    const futureReset = Math.floor(Date.now() / 1000) + 600; // 10 min in future
    trackRateLimits(TEST_UPSTREAM, new Headers({
      'RateLimit-Limit': '100',
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': String(futureReset),
    }));
    expect(isUpstreamThrottled(TEST_UPSTREAM)).toBe(true);
  });
});

describe('recommendThrottleDelay', () => {
  it('returns 0 when no state exists', () => {
    expect(recommendThrottleDelay(TEST_UPSTREAM)).toBe(0);
  });

  it('returns 0 when plenty of quota remains', () => {
    trackRateLimits(TEST_UPSTREAM, new Headers({
      'RateLimit-Limit': '100',
      'RateLimit-Remaining': '80',
      'RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
    }));
    expect(recommendThrottleDelay(TEST_UPSTREAM)).toBe(0);
  });

  it('returns positive delay when quota is low', () => {
    // 5 remaining out of 100 — should trigger delay
    trackRateLimits(TEST_UPSTREAM, new Headers({
      'RateLimit-Limit': '100',
      'RateLimit-Remaining': '5',
      'RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60), // 60s window
    }));

    const delay = recommendThrottleDelay(TEST_UPSTREAM);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(5000); // capped at 5s
  });

  it('returns large delay when remaining is 0', () => {
    const futureReset = Math.floor(Date.now() / 1000) + 30; // 30s from now
    trackRateLimits(TEST_UPSTREAM, new Headers({
      'RateLimit-Limit': '100',
      'RateLimit-Remaining': '0',
      'RateLimit-Reset': String(futureReset),
    }));

    const delay = recommendThrottleDelay(TEST_UPSTREAM);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(60_000);
  });
});

describe('resetRateLimitTracking', () => {
  it('clears state for specific upstream', () => {
    trackRateLimits(TEST_UPSTREAM, new Headers({
      'RateLimit-Limit': '100',
      'RateLimit-Remaining': '50',
      'RateLimit-Reset': '1000',
    }));
    expect(getRateLimitState(TEST_UPSTREAM)).not.toBeNull();
    resetRateLimitTracking(TEST_UPSTREAM);
    expect(getRateLimitState(TEST_UPSTREAM)).toBeNull();
  });

  it('clears all state when no upstream specified', () => {
    trackRateLimits(TEST_UPSTREAM, new Headers({
      'RateLimit-Limit': '100',
      'RateLimit-Remaining': '50',
      'RateLimit-Reset': '1000',
    }));
    trackRateLimits('https://other.example.com', new Headers({
      'RateLimit-Limit': '50',
      'RateLimit-Remaining': '25',
      'RateLimit-Reset': '2000',
    }));

    resetRateLimitTracking();
    expect(getRateLimitState(TEST_UPSTREAM)).toBeNull();
    expect(getRateLimitState('https://other.example.com')).toBeNull();
  });
});
