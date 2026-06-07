import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src/index';

const key = 'a'.repeat(32);

describe('worker routing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes /v1/models to Anthropic models endpoint with Anthropic headers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"data":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const request = new Request('https://proxy.example/v1/models', {
      headers: {
        'x-api-key': key,
        'x-upstream-url': 'https://api.anthropic.com',
        'x-upstream-format': 'anthropic',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'tools-2024-04-04',
      },
    });

    await worker.fetch(request);

    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/models', expect.objectContaining({
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': key,
        'Anthropic-Version': '2023-06-01',
        'Anthropic-Beta': 'tools-2024-04-04',
      },
    }));
  });

  it('forwards Anthropic beta header when translating OpenAI requests to Anthropic', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const request = new Request('https://proxy.example/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${key}`,
        'x-upstream-url': 'https://api.anthropic.com',
        'x-upstream-format': 'anthropic',
        'anthropic-beta': 'tools-2024-04-04',
      },
      body: JSON.stringify({ model: 'claude-test', messages: [{ role: 'user', content: 'hi' }] }),
    });

    await worker.fetch(request);

    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({
      headers: expect.objectContaining({
        'X-Api-Key': key,
        'Anthropic-Version': '2023-06-01',
        'Anthropic-Beta': 'tools-2024-04-04',
      }),
    }));
  });

  it('routes /go-prefixed Anthropic requests to OpenCode Go', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const request = new Request('https://proxy.example/go/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'hi' }] }),
    });

    await worker.fetch(request);

    expect(fetchMock).toHaveBeenCalledWith('https://opencode.ai/zen/go/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: `Bearer ${key}` }),
    }));
  });

  it('routes /zen-prefixed Anthropic requests to OpenCode Zen', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const request = new Request('https://proxy.example/zen/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ model: 'qwen3.5-plus', messages: [{ role: 'user', content: 'hi' }] }),
    });

    await worker.fetch(request);

    expect(fetchMock).toHaveBeenCalledWith('https://opencode.ai/zen/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: `Bearer ${key}` }),
    }));
  });

  it('preserves upstream rate limit headers on translated errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"FreeUsageLimitError"}', {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60',
          'RateLimit-Reset': '1710000000',
        },
      }),
    );

    const request = new Request('https://proxy.example/zen/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ model: 'minimax-m2.5-free', messages: [{ role: 'user', content: 'hi' }] }),
    });

    const response = await worker.fetch(request);

    expect(response.status).toBe(429);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.get('RateLimit-Reset')).toBe('1710000000');
    expect(await response.text()).toBe('{"error":"FreeUsageLimitError"}');
  });

  it('routes /go-prefixed model discovery to OpenCode Go models', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"data":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const request = new Request('https://proxy.example/go/v1/models', {
      headers: { 'x-api-key': key },
    });

    await worker.fetch(request);

    expect(fetchMock).toHaveBeenCalledWith('https://opencode.ai/zen/go/v1/models', expect.objectContaining({
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    }));
  });

  it('routes /zen-prefixed model discovery to OpenCode Zen models', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"data":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const request = new Request('https://proxy.example/zen/v1/models', {
      headers: { 'x-api-key': key },
    });

    await worker.fetch(request);

    expect(fetchMock).toHaveBeenCalledWith('https://opencode.ai/zen/v1/models', expect.objectContaining({
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    }));
  });

  it('overrides model from URL path segment with /go prefix', async () => {
    let capturedBody: any = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const request = new Request('https://proxy.example/go/minimax-m2.5-free/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250514',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    const response = await worker.fetch(request);
    expect(capturedBody.model).toBe('minimax-m2.5-free');
    expect(fetchMock).toHaveBeenCalledWith('https://opencode.ai/zen/go/v1/chat/completions', expect.anything());
  });

  it('overrides model from URL path segment with /zen prefix', async () => {
    let capturedBody: any = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const request = new Request('https://proxy.example/zen/minimax-m2.5-free/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250514',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    await worker.fetch(request);
    expect(capturedBody.model).toBe('minimax-m2.5-free');
    expect(fetchMock).toHaveBeenCalledWith('https://opencode.ai/zen/v1/chat/completions', expect.anything());
  });

  it('returns original model name in response body when model override is active', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const request = new Request('https://proxy.example/go/minimax-m2.5-free/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250514',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    const response = await worker.fetch(request);
    const body = await response.json();
    expect(body.model).toBe('claude-sonnet-4-5-20250514');
  });

  it('does not override model when no model segment in path', async () => {
    let capturedBody: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const request = new Request('https://proxy.example/go/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });

    await worker.fetch(request);
    expect(capturedBody.model).toBe('deepseek-v4-pro');
  });

  it('overrides model to qwen3.6-plus when image attachments are present on the go path', async () => {
    let capturedBody: any = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const request = new Request('https://proxy.example/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
          ],
        }],
        max_tokens: 1024,
      }),
    });

    await worker.fetch(request);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedBody.model).toBe('qwen3.6-plus');
    expect(Array.isArray(capturedBody.messages[0].content)).toBe(true);
    expect(capturedBody.messages[0].content).toEqual([
      { type: 'text', text: 'What is in this image?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
    ]);
  });

  // Regression: BUG — /zen upstream only has mimo-v2.5-free (not qwen3.6-plus).
  // Forcing qwen3.6-plus on /zen image requests caused 404 from upstream.
  // Vision model must be upstream-aware.
  it('overrides model to mimo-v2.5-free when image attachments are present on the zen path', async () => {
    let capturedBody: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const request = new Request('https://proxy.example/zen/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'mimo-v2.5-free',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
          ],
        }],
        max_tokens: 1024,
      }),
    });

    await worker.fetch(request);
    expect(capturedBody.model).toBe('mimo-v2.5-free');
  });

  it('routes /v1/responses to upstream chat/completions', async () => {
    let capturedBody: any = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({
          id: 'chatcmpl-123',
          choices: [{ message: { role: 'assistant', content: 'Hello world' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const request = new Request('https://proxy.example/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        input: [{ type: 'message', role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
        instructions: 'Be helpful',
        stream: false,
      }),
    });

    const response = await worker.fetch(request);
    const body = await response.json();

    // Verify upstream was called with Chat Completions format
    expect(fetchMock).toHaveBeenCalledWith('https://opencode.ai/zen/go/v1/chat/completions', expect.objectContaining({
      method: 'POST',
    }));
    expect(capturedBody.messages[0]).toEqual({ role: 'system', content: 'Be helpful' });
    expect(capturedBody.messages[1]).toEqual({ role: 'user', content: 'Hello' });
    expect(capturedBody.model).toBe('deepseek-v4-flash');

    // Verify response is in Responses API format
    expect(body.object).toBe('response');
    expect(body.id).toMatch(/^resp_/);
    expect(body.output[0].type).toBe('message');
    expect(body.output[0].content[0].text).toBe('Hello world');
    expect(body.status).toBe('completed');
  });

  it('routes /v1/responses with /go prefix', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const request = new Request('https://proxy.example/go/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        input: [{ type: 'message', role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      }),
    });

    await worker.fetch(request);
    expect(globalThis.fetch).toHaveBeenCalledWith('https://opencode.ai/zen/go/v1/chat/completions', expect.anything());
  });

  it('injects DeepSeek thinking for /v1/responses deepseek models', async () => {
    let capturedBody: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const request = new Request('https://proxy.example/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        input: [{ type: 'message', role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      }),
    });

    await worker.fetch(request);
    expect(capturedBody.thinking).toEqual({ type: 'enabled' });
  });

  it('preserves usage from upstream in /v1/responses response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const request = new Request('https://proxy.example/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        input: [{ type: 'message', role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      }),
    });

    const response = await worker.fetch(request);
    const body = await response.json();
    expect(body.usage.input_tokens).toBe(10);
    expect(body.usage.output_tokens).toBe(5);
  });

  it('overrides model to qwen3.6-plus when images present in /v1/responses', async () => {
    let capturedBody: any = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const request = new Request('https://proxy.example/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        input: [{
          type: 'message', role: 'user',
          content: [
            { type: 'input_image', image_url: { url: 'data:image/png;base64,abc' } },
            { type: 'text', text: 'What is this?' },
          ],
        }],
      }),
    });

    await worker.fetch(request);
    expect(capturedBody.model).toBe('qwen3.6-plus');
  });

  // Regression: BUG — same as zen/messages test, but for the Responses API path.
  // /zen/v1/responses with an image must route to mimo-v2.5-free, not qwen3.6-plus.
  it('overrides model to mimo-v2.5-free when images present in /zen/v1/responses', async () => {
    let capturedBody: any = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const request = new Request('https://proxy.example/zen/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'mimo-v2.5-free',
        input: [{
          type: 'message', role: 'user',
          content: [
            { type: 'input_image', image_url: { url: 'data:image/png;base64,abc' } },
            { type: 'text', text: 'What is this?' },
          ],
        }],
      }),
    });

    await worker.fetch(request);
    expect(capturedBody.model).toBe('mimo-v2.5-free');
  });

  it('returns 401 for missing API key', async () => {
    const request = new Request('https://proxy.example/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }] }),
    });

    const response = await worker.fetch(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.type).toBe('authentication_error');
  });

  it('returns 401 for short API key', async () => {
    const request = new Request('https://proxy.example/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'short' },
      body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }] }),
    });

    const response = await worker.fetch(request);
    expect(response.status).toBe(401);
  });

  it('returns 404 for unknown path', async () => {
    const response = await worker.fetch(new Request('https://proxy.example/v1/unknown', {
      headers: { 'x-api-key': key },
    }));

    expect(response.status).toBe(404);
  });

  it('handles OPTIONS preflight with CORS headers', async () => {
    const response = await worker.fetch(new Request('https://proxy.example/v1/responses', {
      method: 'OPTIONS',
      headers: { 'origin': 'https://example.com' },
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  // ── Regression tests for QA-flagged routing bug fixes ──

  // Regression: root / endpoint returns full topology info WITHOUT requiring auth
  // (info disclosure is acceptable here since the routes are documented in README)
  it('returns full info on root / when authenticated', async () => {
    const response = await worker.fetch(new Request('https://proxy.example/', {
      headers: { 'x-api-key': key },
    }));
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.name).toBe('opencode-cowork-proxy');
    expect(body.routes).toBeDefined();
    expect(body.endpoints).toBeDefined();
  });

  it('returns full info on root / WITHOUT authentication', async () => {
    const response = await worker.fetch(new Request('https://proxy.example/'));
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.name).toBe('opencode-cowork-proxy');
    expect(body.routes).toBeDefined();
    expect(body.endpoints).toBeDefined();
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

  // Regression: MEDIUM bug M1 from QA report — on /v1/responses, vision model override
  // must run BEFORE DeepSeek thinking injection. If image is present, the model should
  // be qwen3.6-plus and the request body should NOT have a thinking parameter.
  it('applies vision override before thinking injection on /v1/responses', async () => {
    let capturedBody: any;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({
        id: 'resp_test', object: 'response', status: 'completed',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
        usage: { input_tokens: 5, output_tokens: 2 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const request = new Request('https://proxy.example/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        input: [
          { type: 'message', role: 'user', content: [
            { type: 'input_image', image_url: { url: 'data:image/png;base64,abc' } },
            { type: 'text', text: 'What is this?' },
          ]},
        ],
      }),
    });
    await worker.fetch(request);

    // Vision override should have set the model to qwen3.6-plus
    expect(capturedBody.model).toBe('qwen3.6-plus');
    // Thinking config must NOT be present (would have been injected for deepseek-v4-pro)
    expect(capturedBody.thinking).toBeUndefined();
  });

  // ── FIX 1 — Pass-through paths return 400 for malformed JSON body ──
  it('returns 400 for malformed JSON body on Anthropic pass-through path', async () => {
    const request = new Request('https://proxy.example/go/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'x-upstream-format': 'anthropic' },
      body: '{invalid json here',
    });
    const response = await worker.fetch(request);
    expect(response.status).toBe(400);
    const body = await response.json();
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
    const body = await response.json();
    expect(body.error.type).toBe('invalid_request_error');
  });

  // ── FIX 4 — Path-aware auth error format ──
  it('returns Anthropic error format on /v1/messages auth failure', async () => {
    const request = new Request('https://proxy.example/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const response = await worker.fetch(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    // Anthropic format: { type: "error", error: { type: "...", message: "..." } }
    expect(body.type).toBe('error');
    expect(body.error.type).toBe('authentication_error');
  });

  it('returns Anthropic error format on /v1/models auth failure', async () => {
    const request = new Request('https://proxy.example/go/v1/models', {
      headers: { 'x-upstream-format': 'anthropic' },
    });
    const response = await worker.fetch(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.type).toBe('error');
    expect(body.error.type).toBe('authentication_error');
  });

  it('returns OpenAI error format on /v1/chat/completions auth failure', async () => {
    const request = new Request('https://proxy.example/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const response = await worker.fetch(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    // OpenAI format: { error: { type: "...", message: "..." } } (no outer type field)
    expect(body.type).toBeUndefined();
    expect(body.error.type).toBe('authentication_error');
  });

  // ── FIX 6 — Image detection in system prompt ──
  it('overrides model to qwen3.6-plus when image is in Anthropic system prompt', async () => {
    let capturedBody: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const request = new Request('https://proxy.example/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        system: [
          { type: 'text', text: 'You are a helpful assistant.' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
        ],
        messages: [{ role: 'user', content: 'What is in this image?' }],
        max_tokens: 1024,
      }),
    });

    await worker.fetch(request);
    expect(capturedBody.model).toBe('qwen3.6-plus');
  });

  // Regression: BUG — pass-through path on /zen must also pick the free vision model.
  // /zen/v1/chat/completions with an OpenAI-format image_url should use mimo-v2.5-free.
  it('overrides model to mimo-v2.5-free for OpenAI pass-through with images on /zen', async () => {
    let capturedBody: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const request = new Request('https://proxy.example/zen/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'mimo-v2.5-free',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
          ],
        }],
      }),
    });

    await worker.fetch(request);
    expect(capturedBody.model).toBe('mimo-v2.5-free');
  });

  // ========================================================================
  // Vision-aware model override: if requested model is already vision-capable
  // on the routed upstream, keep it (no override). Otherwise fall back to
  // the default vision model. See VISION_CAPABLE_GO/ZEN in src/index.ts.
  // ========================================================================

  it('keeps vision-capable model claude-sonnet-4-6 when image is in /v1/messages on /go', async () => {
    let capturedBody: any = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const request = new Request('https://proxy.example/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
          ],
        }],
        max_tokens: 1024,
      }),
    });

    await worker.fetch(request);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // claude-sonnet-4-6 is in VISION_CAPABLE_GO — no override should happen
    expect(capturedBody.model).toBe('claude-sonnet-4-6');
  });

  it('keeps vision-capable model qwen3.6-plus when image is in /zen/v1/chat/completions', async () => {
    let capturedBody: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ choices: [{ message: 'ok', finish_reason: 'stop' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const request = new Request('https://proxy.example/zen/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'qwen3.6-plus',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image.' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,xyz' } },
          ],
        }],
      }),
    });

    await worker.fetch(request);
    // qwen3.6-plus is in VISION_CAPABLE_ZEN — no override
    expect(capturedBody.model).toBe('qwen3.6-plus');
  });

  it('URL path override with vision-capable model is kept on /go', async () => {
    // When URL path override is /go/claude-sonnet-4-6/v1/messages and image is present,
    // the override model is vision-capable so should not be further overridden to qwen3.6-plus.
    let capturedBody: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ choices: [{ message: 'ok', finish_reason: 'stop' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const request = new Request('https://proxy.example/go/claude-sonnet-4-6/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',  // body model is non-vision
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
          ],
        }],
      }),
    });

    await worker.fetch(request);
    // URL override "claude-sonnet-4-6" wins, AND it's vision-capable so stays
    expect(capturedBody.model).toBe('claude-sonnet-4-6');
  });

  it('URL path override with non-vision model falls back to default vision model on /go', async () => {
    // When URL path override is /go/deepseek-v4-flash/v1/messages and image is present,
    // deepseek-v4-flash is not vision-capable, so should be overridden to qwen3.6-plus.
    let capturedBody: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ choices: [{ message: 'ok', finish_reason: 'stop' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const request = new Request('https://proxy.example/go/deepseek-v4-flash/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',  // body is vision-capable, but URL override wins
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
          ],
        }],
      }),
    });

    await worker.fetch(request);
    // URL override "deepseek-v4-flash" wins, but it's NOT vision-capable → force to qwen3.6-plus
    expect(capturedBody.model).toBe('qwen3.6-plus');
  });

  it('unknown model in body falls back to default vision model on /go', async () => {
    // An unrecognized model name (not in VISION_CAPABLE_GO) should be treated as
    // not-vision-capable and force-override to the default vision model.
    let capturedBody: any = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(JSON.stringify({ choices: [{ message: 'ok', finish_reason: 'stop' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );

    const request = new Request('https://proxy.example/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({
        model: 'some-unknown-model-2027',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image.' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
          ],
        }],
        max_tokens: 1024,
      }),
    });

    await worker.fetch(request);
    expect(capturedBody.model).toBe('qwen3.6-plus');
  });
});
