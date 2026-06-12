import { describe, it, expect, beforeEach } from 'vitest';
import { getCachedResponse, setCachedResponse, getCacheStats, clearCache } from '../src/response-cache';

const TEST_UPSTREAM = 'https://test.example.com';
const TEST_PATH = '/v1/chat/completions';
const TEST_BODY = '{"model":"test","messages":[{"role":"user","content":"hi"}]}';

describe('response-cache', () => {
  beforeEach(() => {
    clearCache();
  });

  it('returns null for uncached requests', () => {
    const cached = getCachedResponse(TEST_UPSTREAM, TEST_PATH, TEST_BODY);
    expect(cached).toBeNull();
  });

  it('stores and retrieves a cached response', async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    await setCachedResponse(TEST_UPSTREAM, TEST_PATH, TEST_BODY, response);

    const cached = getCachedResponse(TEST_UPSTREAM, TEST_PATH, TEST_BODY);
    expect(cached).not.toBeNull();
    expect(cached!.status).toBe(200);
    const body = await cached!.json();
    expect(body).toEqual({ ok: true });
  });

  it('returns null for different body', async () => {
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

    await setCachedResponse(TEST_UPSTREAM, TEST_PATH, TEST_BODY, response);

    const cached = getCachedResponse(TEST_UPSTREAM, TEST_PATH, 'different-body');
    expect(cached).toBeNull();
  });

  it('does not cache error responses', async () => {
    const errorResponse = new Response(JSON.stringify({ error: 'fail' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });

    await setCachedResponse(TEST_UPSTREAM, TEST_PATH, TEST_BODY, errorResponse);

    const cached = getCachedResponse(TEST_UPSTREAM, TEST_PATH, TEST_BODY);
    expect(cached).toBeNull();
  });

  it('getCacheStats returns size and entries', async () => {
    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
    await setCachedResponse(TEST_UPSTREAM, TEST_PATH, TEST_BODY, response, 60_000);

    const stats = getCacheStats();
    expect(stats.size).toBe(1);
    expect(stats.entries[0].hitCount).toBe(0);
    expect(stats.entries[0].ttlRemaining).toBeGreaterThan(0);
  });

  it('clearCache removes all entries', async () => {
    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
    await setCachedResponse(TEST_UPSTREAM, TEST_PATH, TEST_BODY, response);

    expect(getCacheStats().size).toBe(1);
    clearCache();
    expect(getCacheStats().size).toBe(0);
  });

  it('increments hitCount on cache hit', async () => {
    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
    await setCachedResponse(TEST_UPSTREAM, TEST_PATH, TEST_BODY, response);

    getCachedResponse(TEST_UPSTREAM, TEST_PATH, TEST_BODY);
    getCachedResponse(TEST_UPSTREAM, TEST_PATH, TEST_BODY);

    const stats = getCacheStats();
    expect(stats.entries[0].hitCount).toBe(2);
  });
});
