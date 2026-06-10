import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src/index';

const key = 'a'.repeat(32);

describe('Responses API', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes /v1/responses to upstream chat/completions', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url: string, init: { body?: string }) => {
        capturedBody = JSON.parse(init.body ?? '{}');
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
    const body = await response.json() as {
      object: string; id: string; status: string;
      output: Array<{ type: string; content: Array<{ type: string; text: string }> }>;
    };
    const upstream = capturedBody as unknown as { messages: Array<{ role: string; content: string }>; model: string };

    // Verify upstream was called with Chat Completions format
    expect(fetchMock).toHaveBeenCalledWith('https://opencode.ai/zen/go/v1/chat/completions', expect.objectContaining({
      method: 'POST',
    }));
    expect(upstream.messages[0]).toEqual({ role: 'system', content: 'Be helpful' });
    expect(upstream.messages[1]).toEqual({ role: 'user', content: 'Hello' });
    expect(upstream.model).toBe('deepseek-v4-flash');

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
    let capturedBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url: string, init: { body?: string }) => {
        capturedBody = JSON.parse(init.body ?? '{}');
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
    const upstream = capturedBody as unknown as { thinking?: { type: string } };
    expect(upstream.thinking).toEqual({ type: 'enabled' });
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
    const body = await response.json() as { usage: { input_tokens: number; output_tokens: number } };
    expect(body.usage.input_tokens).toBe(10);
    expect(body.usage.output_tokens).toBe(5);
  });

  it('overrides model to qwen3.6-plus when images present in /v1/responses', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url: string, init: { body?: string }) => {
        capturedBody = JSON.parse(init.body ?? '{}');
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
    // Verify the model was overridden to the Go default vision model
    const ub = capturedBody as unknown as { model: string };
    expect(ub.model).toBe('qwen3.6-plus');
  });

  // Regression: BUG — same as zen/messages test, but for the Responses API path.
  // /zen/v1/responses with an image must route to mimo-v2.5-free, not qwen3.6-plus.
  it('overrides model to mimo-v2.5-free when images present in /zen/v1/responses', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url: string, init: { body?: string }) => {
        capturedBody = JSON.parse(init.body ?? '{}');
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
    const ub = capturedBody as unknown as { model: string };
    expect(ub.model).toBe('mimo-v2.5-free');
  });

  // Regression: MEDIUM bug M1 from QA report — on /v1/responses, vision model override
  // must run BEFORE DeepSeek thinking injection. If image is present, the model should
  // be qwen3.6-plus and the request body should NOT have a thinking parameter.
  it('applies vision override before thinking injection on /v1/responses', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string, init: { body?: string }) => {
      capturedBody = JSON.parse(init?.body ?? '{}');
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
    const upstream = capturedBody as unknown as { model: string; thinking?: unknown };
    expect(upstream.model).toBe('qwen3.6-plus');
    // Thinking config must NOT be present (would have been injected for deepseek-v4-pro)
    expect(upstream.thinking).toBeUndefined();
  });
});
