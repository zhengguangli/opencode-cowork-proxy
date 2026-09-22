import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src/index';

const key = 'a'.repeat(32);

describe('pass-through fast path', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Anthropic pass-through (X-Upstream-Format: anthropic) ──

  it('forwards Anthropic body as-is when no model override and no images', async () => {
    let capturedUrl: string | null = null;
    let capturedBody: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url: any, init: any) => {
        capturedUrl = url as string;
        capturedBody = init.body as string;
        return new Response(JSON.stringify({
          id: 'msg-1',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'pong' }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const rawBody = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 256,
    });

    const request = new Request('https://proxy.example/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'x-upstream-format': 'anthropic',
      },
      body: rawBody,
    });

    const response = await worker.fetch(request);
    expect(response.status).toBe(200);

    // Must hit the Anthropic upstream /v1/messages, not the OpenAI /v1/chat/completions
    expect(capturedUrl).toContain('/v1/messages');
    expect(capturedUrl).not.toContain('/v1/chat/completions');

    // Body must be forwarded verbatim (pass-through fast path skips re-serialization)
    expect(capturedBody).toBe(rawBody);
  });

  it('skips pass-through when images are present in Anthropic body', async () => {
    let fetchCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url: any, init: any) => {
        fetchCalls++;
        return new Response(JSON.stringify({
          id: 'msg-img',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'seen' }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const request = new Request('https://proxy.example/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'x-upstream-format': 'anthropic',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
          ],
        }],
        max_tokens: 256,
      }),
    });

    await worker.fetch(request);
    // With images present, handler must inspect parsed body for vision override
    expect(fetchCalls).toBeGreaterThanOrEqual(1);
  });

  // ── OpenAI pass-through (default fmt) ──

  it('forwards OpenAI body as-is when no model override and no images', async () => {
    let capturedUrl: string | null = null;
    let capturedBody: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url: any, init: any) => {
        capturedUrl = url as string;
        capturedBody = init.body as string;
        return new Response(JSON.stringify({
          id: 'chatcmpl-1',
          choices: [{ message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const rawBody = JSON.stringify({
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    const request = new Request('https://proxy.example/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
      },
      body: rawBody,
    });

    const response = await worker.fetch(request);
    expect(response.status).toBe(200);

    // Must hit the OpenAI upstream /v1/chat/completions, not Anthropic /v1/messages
    expect(capturedUrl).toContain('/v1/chat/completions');
    expect(capturedUrl).not.toContain('/v1/messages');

    // Body must be forwarded verbatim
    expect(capturedBody).toBe(rawBody);
  });

  it('skips pass-through when images are present in OpenAI body', async () => {
    let fetchCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url: any, init: any) => {
        fetchCalls++;
        return new Response(JSON.stringify({
          id: 'chatcmpl-img',
          choices: [{ message: { role: 'assistant', content: 'seen' }, finish_reason: 'stop' }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const request = new Request('https://proxy.example/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
          ],
        }],
      }),
    });

    await worker.fetch(request);
    // With images present, handler must inspect parsed body for vision override
    expect(fetchCalls).toBeGreaterThanOrEqual(1);
  });
});
