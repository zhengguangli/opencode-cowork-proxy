import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src/index';

const key = 'a'.repeat(32);

// Regression: safeUpstreamFetch() used to JSON.parse() the request body on every
// fetch (and every retry) just to read the `stream` boolean. On multi-MB bodies
// that parse cost more CPU than the fetch itself. It now uses a cheap regex
// pre-check. These tests pin the *behavior* that must survive that change:
// a streaming request is never retried after a network error (SSE can't be
// replayed), while a non-streaming one is retried up to MAX_RETRIES.
describe('safeUpstreamFetch stream detection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function countFetchesOnNetworkError(body: string): Promise<number> {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    return worker
      .fetch(
        new Request('https://proxy.example/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': key },
          body,
        }),
      )
      .then(() => spy.mock.calls.length);
  }

  it('does not retry a streaming request after a network error', async () => {
    const calls = await countFetchesOnNetworkError(
      JSON.stringify({ model: 'test', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    );
    expect(calls).toBe(1);
  });

  it('retries a non-streaming request after a network error', async () => {
    const calls = await countFetchesOnNetworkError(
      JSON.stringify({ model: 'test', stream: false, messages: [{ role: 'user', content: 'hi' }] }),
    );
    expect(calls).toBe(3); // 1 initial + 2 retries
  });

  it('treats a body with no stream field as non-streaming', async () => {
    const calls = await countFetchesOnNetworkError(
      JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }] }),
    );
    expect(calls).toBe(3);
  });

  it('detects stream:true regardless of whitespace or key order', async () => {
    const calls = await countFetchesOnNetworkError(
      '{"messages":[],"model":"test",\n  "stream"  :  true}',
    );
    expect(calls).toBe(1);
  });

  it('does not mistake an escaped stream:true inside message content for the flag', async () => {
    const calls = await countFetchesOnNetworkError(
      JSON.stringify({
        model: 'test',
        messages: [{ role: 'user', content: 'please set "stream": true in your config' }],
      }),
    );
    // JSON.stringify escapes the inner quotes, so the body holds \"stream\": true
    // and the regex must not match it.
    expect(calls).toBe(3);
  });

  it('retries a 5xx even for streaming requests (no SSE was produced yet)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":{"message":"upstream unavailable"}}', {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await worker.fetch(
      new Request('https://proxy.example/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ model: 'test', stream: true, messages: [] }),
      }),
    );
    expect(spy.mock.calls.length).toBe(3);
  });
});
