import { describe, it, expect, vi, afterEach } from 'vitest';
import { getVisionModel, hasImages, hasOpenAIImages, hasResponsesImages, rawBodyMayHaveImages, hasAnyImageInMessages } from '../src/vision';
import { GO_VISION_MODEL, ZEN_VISION_MODEL } from '../src/config';
import worker from '../src/index';

const key = 'a'.repeat(32);

const GO = 'https://opencode.ai/zen/go';
const ZEN = 'https://opencode.ai/zen';

describe('getVisionModel', () => {
  it('keeps vision-capable GO model on GO upstream', () => {
    expect(getVisionModel(GO, 'claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('keeps vision-capable ZEN model on ZEN upstream', () => {
    expect(getVisionModel(ZEN, 'mimo-v2.5-free')).toBe('mimo-v2.5-free');
  });

  it('forces GO vision model for non-vision model on GO upstream', () => {
    expect(getVisionModel(GO, 'deepseek-v4-flash')).toBe(GO_VISION_MODEL);
  });

  it('forces ZEN vision model for non-vision model on ZEN upstream', () => {
    expect(getVisionModel(ZEN, 'deepseek-v4-flash')).toBe(ZEN_VISION_MODEL);
  });

  it('returns GO default when no model requested', () => {
    expect(getVisionModel(GO, null)).toBe(GO_VISION_MODEL);
    expect(getVisionModel(GO, undefined)).toBe(GO_VISION_MODEL);
  });

  it('returns GO default for unrecognized upstream', () => {
    expect(getVisionModel('https://unknown.com', 'some-model')).toBe(GO_VISION_MODEL);
  });
});

describe('hasImages', () => {
  it('detects image in messages content', () => {
    const body = { messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', data: 'abc' } }] }] };
    expect(hasImages(body)).toBe(true);
  });

  it('returns false when no images in messages', () => {
    const body = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] };
    expect(hasImages(body)).toBe(false);
  });

  it('returns false for empty messages', () => {
    expect(hasImages({ messages: [] })).toBe(false);
  });

  it('returns false for undefined body', () => {
    expect(hasImages(undefined as unknown as Record<string, unknown>)).toBe(false);
  });

  it('returns false for null body', () => {
    expect(hasImages(null as unknown as Record<string, unknown>)).toBe(false);
  });

  it('detects image in system content', () => {
    const body = { messages: [], system: [{ type: 'image', source: { type: 'base64', data: 'abc' } }] };
    expect(hasImages(body)).toBe(true);
  });
});

describe('hasOpenAIImages', () => {
  it('detects image_url in messages', () => {
    const body = { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/img.jpg' } }] }] };
    expect(hasOpenAIImages(body)).toBe(true);
  });

  it('returns false for string content', () => {
    const body = { messages: [{ role: 'user', content: 'text-only' }] };
    expect(hasOpenAIImages(body)).toBe(false);
  });

  it('returns false when no images', () => {
    const body = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] };
    expect(hasOpenAIImages(body)).toBe(false);
  });

  it('detects image_url in system', () => {
    const body = { messages: [], system: [{ type: 'image_url', image_url: { url: 'https://example.com/img.jpg' } }] };
    expect(hasOpenAIImages(body)).toBe(true);
  });
});

describe('hasResponsesImages', () => {
  it('detects input_image in input items', () => {
    const body = { input: [{ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: { url: 'https://ex.com/img.jpg' } }] }] };
    expect(hasResponsesImages(body)).toBe(true);
  });

  it('detects image_url in input items', () => {
    const body = { input: [{ type: 'message', role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://ex.com/img.jpg' } }] }] };
    expect(hasResponsesImages(body)).toBe(true);
  });

  it('returns false for non-array input', () => {
    expect(hasResponsesImages({ input: 'string' })).toBe(false);
  });

  it('returns false for missing input', () => {
    expect(hasResponsesImages({})).toBe(false);
  });

  it('returns false for input without images', () => {
    const body = { input: [{ type: 'message', role: 'user', content: [{ type: 'text', text: 'hello' }] }] };
    expect(hasResponsesImages(body)).toBe(false);
  });
});

describe('rawBodyMayHaveImages', () => {
  it('detects "image_url" in raw body', () => {
    expect(rawBodyMayHaveImages('{"messages":[{"image_url":"..."}]}')).toBe(true);
  });

  it('detects "input_image" in raw body', () => {
    expect(rawBodyMayHaveImages('{"input_image":{}}')).toBe(true);
  });

  it('detects "type":"image" in raw body', () => {
    expect(rawBodyMayHaveImages('{"type":"image"}')).toBe(true);
  });

  it('detects "type": "image" with space in raw body', () => {
    expect(rawBodyMayHaveImages('{"type": "image"}')).toBe(true);
  });

  it('returns false for body without image markers', () => {
    expect(rawBodyMayHaveImages('{"messages":[{"role":"user","content":"hi"}]}')).toBe(false);
  });
});

describe('hasAnyImageInMessages', () => {
  it('detects image in messages', () => {
    const body = { messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', data: 'abc' } }] }] };
    expect(hasAnyImageInMessages(body)).toBe(true);
  });

  it('detects image_url in messages', () => {
    const body = { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://ex.com/img.jpg' } }] }] };
    expect(hasAnyImageInMessages(body)).toBe(true);
  });

  it('returns false for string content', () => {
    const body = { messages: [{ role: 'user', content: 'just text' }] };
    expect(hasAnyImageInMessages(body)).toBe(false);
  });

  it('returns false for non-array content', () => {
    const body = { messages: [{ role: 'user', content: 'text' }] };
    expect(hasAnyImageInMessages(body)).toBe(false);
  });

  it('returns false when no messages', () => {
    expect(hasAnyImageInMessages({})).toBe(false);
  });

  it('detects image in system', () => {
    const body = { system: [{ type: 'image_url', image_url: { url: 'https://ex.com/img.jpg' } }] };
    expect(hasAnyImageInMessages(body)).toBe(true);
  });
});

// ── Integration tests (end-to-end via worker.fetch) ──

describe('vision (integration)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('overrides model to qwen3.6-plus when image attachments are present on the go path', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body ?? '{}');
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
    const ub = capturedBody as unknown as { model: string; messages: Array<{ content: unknown }> };
    expect(ub.model).toBe('qwen3.6-plus');
    expect(Array.isArray(ub.messages)).toBe(true);
    expect(ub.messages[0].content).toEqual([
      { type: 'text', text: 'What is in this image?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
    ]);
  });

  // Regression: BUG — /zen upstream only has mimo-v2.5-free (not qwen3.6-plus).
  it('overrides model to mimo-v2.5-free when image attachments are present on the zen path', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body ?? '{}');
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
    expect(capturedBody!.model).toBe('mimo-v2.5-free');
  });

  // FIX 6 — Image detection in system prompt
  it('overrides model to qwen3.6-plus when image is in Anthropic system prompt', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body ?? '{}');
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
    expect(capturedBody!.model).toBe('qwen3.6-plus');
  });

  // Regression: BUG — pass-through path on /zen must also pick the free vision model.
  it('overrides model to mimo-v2.5-free for OpenAI pass-through with images on /zen', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body ?? '{}');
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
    expect(capturedBody!.model).toBe('mimo-v2.5-free');
  });

  it('keeps vision-capable model claude-sonnet-4-6 when image is in /v1/messages on /go', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body ?? '{}');
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
    expect(capturedBody!.model).toBe('claude-sonnet-4-6');
  });

  it('keeps vision-capable model qwen3.6-plus when image is in /zen/v1/chat/completions', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body ?? '{}');
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
    expect(capturedBody!.model).toBe('qwen3.6-plus');
  });

  it('URL path override with vision-capable model is kept on /go', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body ?? '{}');
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
    expect(capturedBody!.model).toBe('claude-sonnet-4-6');
  });

  it('URL path override with non-vision model falls back to default vision model on /go', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body ?? '{}');
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
    expect(capturedBody!.model).toBe('qwen3.6-plus');
  });

  it('unknown model in body falls back to default vision model on /go', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body ?? '{}');
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
    expect(capturedBody!.model).toBe('qwen3.6-plus');
  });
});
