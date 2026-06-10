import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src/index';

const key = 'a'.repeat(32);

describe('error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Regression: HIGH bug H1/H2 from QA report — X-Request-Id and rate-limit headers
  // from upstream must be forwarded to client on 200 (not just error) responses.
  it('forwards X-Request-Id and RateLimit-* headers from upstream on 200 responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'req-test-123',
          'RateLimit-Limit': '100',
          'RateLimit-Remaining': '99',
          'RateLimit-Reset': '30',
        },
      }),
    );

    const request = new Request('https://proxy.example/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const response = await worker.fetch(request);

    expect(response.headers.get('X-Request-Id')).toBe('req-test-123');
    expect(response.headers.get('RateLimit-Limit')).toBe('100');
    expect(response.headers.get('RateLimit-Remaining')).toBe('99');
    expect(response.headers.get('RateLimit-Reset')).toBe('30');
  });

  // Regression: HIGH bug H3 from QA report — pass-through paths must check !res.ok
  // and forward upstream error response (not silently return upstream body).
  it('forwards upstream error response on pass-through path (e.g. /go/v1/messages)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":{"message":"upstream rate limited"}}', {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      }),
    );

    const request = new Request('https://proxy.example/go/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }], max_tokens: 10 }),
    });
    const response = await worker.fetch(request);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
  });

  // FIX 1 — Pass-through paths return 400 for malformed JSON body
  it('returns 400 for malformed JSON body on Anthropic pass-through path', async () => {
    const request = new Request('https://proxy.example/go/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'x-upstream-format': 'anthropic' },
      body: '{invalid json here',
    });
    const response = await worker.fetch(request);
    expect(response.status).toBe(400);
    const body = await response.json() as { error: { type: string } };
    expect(body.error.type).toBe('invalid_request_error');
  });

  it('returns 400 for malformed JSON body on OpenAI pass-through path', async () => {
    const request = new Request('https://proxy.example/go/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: 'not json at all',
    });
    const response = await worker.fetch(request);
    expect(response.status).toBe(400);
    const body = await response.json() as { error: { type: string } };
    expect(body.error.type).toBe('invalid_request_error');
  });

  // Body size limit: 413 on oversized Content-Length
  it('rejects requests with body exceeding MAX_BODY_SIZE', async () => {
    const oversized = 11 * 1024 * 1024; // > 10 MB
    const request = new Request('https://proxy.example/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(oversized),
        'x-api-key': key,
      },
      body: '{}',
    });
    const response = await worker.fetch(request);
    expect(response.status).toBe(413);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toContain('maximum size');
  });

  it('allows requests within body size limit', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const request = new Request('https://proxy.example/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '100',
        'x-api-key': key,
      },
      body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const response = await worker.fetch(request);
    expect(response.status).toBe(200);
  });

  // Retry behavior: 5xx triggers retry, 4xx does not
  it('retries on upstream 5xx error', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('{"error":"server error"}', { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const request = new Request('https://proxy.example/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const response = await worker.fetch(request);
    expect(response.status).toBe(200);
    expect(callCount).toBe(2); // 1 retry after first 500
  }, 10_000);

  it('does not retry on upstream 4xx error', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      return new Response('{"error":"bad request"}', { status: 400, headers: { 'Content-Type': 'application/json' } });
    });

    const request = new Request('https://proxy.example/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const response = await worker.fetch(request);
    expect(response.status).toBe(400);
    expect(callCount).toBe(1); // No retry
  });
});
