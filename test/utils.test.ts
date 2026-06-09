import { describe, it, expect } from 'vitest';
import { anthropicHeaders, upstreamErrorResponse, forwardUpstreamHeaders, formatUptime, jsonResponse, safeJsonBody } from '../src/request';

describe('anthropicHeaders', () => {
  it('includes X-Api-Key and Content-Type', () => {
    const req = new Request('http://localhost/');
    const h = anthropicHeaders(req, 'sk-test-key');
    expect(h['Content-Type']).toBe('application/json');
    expect(h['X-Api-Key']).toBe('sk-test-key');
    expect(h['Anthropic-Version']).toBe('2023-06-01');
  });

  it('uses custom Anthropic-Version when present', () => {
    const req = new Request('http://localhost/', {
      headers: { 'Anthropic-Version': '2025-01-01' },
    });
    const h = anthropicHeaders(req, 'sk-key');
    expect(h['Anthropic-Version']).toBe('2025-01-01');
  });

  it('includes Anthropic-Beta when present', () => {
    const req = new Request('http://localhost/', {
      headers: { 'Anthropic-Beta': 'tools-2024-04-04' },
    });
    const h = anthropicHeaders(req, 'sk-key');
    expect(h['Anthropic-Beta']).toBe('tools-2024-04-04');
  });

  it('omits Anthropic-Beta when not present', () => {
    const req = new Request('http://localhost/');
    const h = anthropicHeaders(req, 'sk-key');
    expect(h['Anthropic-Beta']).toBeUndefined();
  });
});

describe('upstreamErrorResponse', () => {
  it('forwards status code', () => {
    const upstream = new Response('{"error":"rate limited"}', { status: 429 });
    const result = upstreamErrorResponse(upstream, '{"error":"rate limited"}');
    expect(result.status).toBe(429);
  });

  it('forwards Retry-After header', () => {
    const upstream = new Response('error', {
      status: 429,
      headers: { 'Retry-After': '30' },
    });
    const result = upstreamErrorResponse(upstream, 'error');
    expect(result.headers.get('Retry-After')).toBe('30');
  });

  it('forwards RateLimit headers', () => {
    const upstream = new Response('error', {
      status: 429,
      headers: { 'RateLimit-Limit': '100', 'RateLimit-Remaining': '0' },
    });
    const result = upstreamErrorResponse(upstream, 'error');
    expect(result.headers.get('RateLimit-Limit')).toBe('100');
    expect(result.headers.get('RateLimit-Remaining')).toBe('0');
  });

  it('forwards Content-Type', () => {
    const upstream = new Response('{"error":"bad"}', {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    const result = upstreamErrorResponse(upstream, '{"error":"bad"}');
    expect(result.headers.get('Content-Type')).toBe('application/json');
  });

  it('preserves error body', async () => {
    const upstream = new Response('{"error":"invalid"}', { status: 400 });
    const result = upstreamErrorResponse(upstream, '{"error":"invalid"}');
    const text = await result.text();
    expect(text).toBe('{"error":"invalid"}');
  });
});

describe('forwardUpstreamHeaders', () => {
  it('forwards matching headers from upstream to target', () => {
    const target = new Headers();
    const source = new Response(null, {
      headers: { 'X-Request-Id': 'abc-123', 'RateLimit-Limit': '100' },
    });
    forwardUpstreamHeaders(target, source);
    expect(target.get('X-Request-Id')).toBe('abc-123');
    expect(target.get('RateLimit-Limit')).toBe('100');
  });

  it('does not forward non-whitelisted headers', () => {
    const target = new Headers();
    const source = new Response(null, {
      headers: { 'X-Custom': 'value', 'Content-Type': 'text/plain' },
    });
    forwardUpstreamHeaders(target, source);
    expect(target.get('X-Custom')).toBeNull();
  });
});

describe('formatUptime', () => {
  it('formats seconds', () => {
    expect(formatUptime(30)).toBe('30s');
  });

  it('formats minutes and seconds', () => {
    expect(formatUptime(125)).toBe('2m 5s');
  });

  it('formats hours and minutes', () => {
    expect(formatUptime(3661)).toBe('1h 1m');
  });

  it('formats exact hours', () => {
    expect(formatUptime(7200)).toBe('2h 0m');
  });
});

describe('jsonResponse', () => {
  it('returns JSON response with content-type', async () => {
    const req = new Request('http://localhost/');
    const res = await jsonResponse(req, { status: 'ok' });
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = await res.json();
    expect(body).toEqual({ status: 'ok' });
  });

  it('includes extra headers', async () => {
    const req = new Request('http://localhost/');
    const res = await jsonResponse(req, { ok: true }, { 'X-Custom': 'val' });
    expect(res.headers.get('X-Custom')).toBe('val');
  });

  it('compresses with gzip for large bodies when client accepts gzip', async () => {
    const req = new Request('http://localhost/', {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    const largeData = { data: 'x'.repeat(2000) };
    const res = await jsonResponse(req, largeData);
    expect(res.headers.get('Content-Encoding')).toBe('gzip');
    expect(res.headers.get('Vary')).toBe('Accept-Encoding');
  });
});

describe('safeJsonBody', () => {
  it('parses valid JSON', async () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ key: 'value' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const result = await safeJsonBody<Record<string, unknown>>(req);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ key: 'value' });
    }
  });

  it('returns error for invalid JSON', async () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    });
    const result = await safeJsonBody<unknown>(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
    }
  });
});
