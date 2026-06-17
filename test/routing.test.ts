import { describe, it, expect, vi, afterEach } from 'vitest';
import { routeConfig, getUpstream, upstreamFormat } from '../src/routing';
import { GO_UPSTREAM, ZEN_UPSTREAM, DEFAULT_UPSTREAM } from '../src/config';
import worker from '../src/index';

const key = 'a'.repeat(32);

describe('routeConfig', () => {
  it('routes /v1/messages to default upstream', () => {
    const req = new Request('http://localhost/v1/messages');
    const r = routeConfig(req);
    expect(r.path).toBe('/v1/messages');
    expect(r.upstream).toBe(DEFAULT_UPSTREAM);
    expect(r.modelOverride).toBeNull();
  });

  it('routes /go/v1/messages to GO upstream', () => {
    const req = new Request('http://localhost/go/v1/messages');
    const r = routeConfig(req);
    expect(r.path).toBe('/v1/messages');
    expect(r.upstream).toBe(GO_UPSTREAM);
  });

  it('routes /zen/v1/messages to ZEN upstream', () => {
    const req = new Request('http://localhost/zen/v1/messages');
    const r = routeConfig(req);
    expect(r.path).toBe('/v1/messages');
    expect(r.upstream).toBe(ZEN_UPSTREAM);
  });

  it('extracts model override from /go/<model>/v1/messages', () => {
    const req = new Request('http://localhost/go/deepseek-v4/v1/messages');
    const r = routeConfig(req);
    expect(r.path).toBe('/v1/messages');
    expect(r.modelOverride).toBe('deepseek-v4');
  });

  it('extracts model override from /zen/<model>/v1/messages', () => {
    const req = new Request('http://localhost/zen/claude-sonnet-4/v1/chat/completions');
    const r = routeConfig(req);
    expect(r.path).toBe('/v1/chat/completions');
    expect(r.modelOverride).toBe('claude-sonnet-4');
  });

  it('handles root path /', () => {
    const req = new Request('http://localhost/');
    const r = routeConfig(req);
    expect(r.path).toBe('/');
    expect(r.modelOverride).toBeNull();
  });

  it('handles model override at root path /go/<model>/', () => {
    const req = new Request('http://localhost/go/deepseek-v4/');
    const r = routeConfig(req);
    expect(r.path).toBe('/');
    expect(r.modelOverride).toBe('deepseek-v4');
  });

  it('handles /v1/responses path', () => {
    const req = new Request('http://localhost/v1/responses');
    const r = routeConfig(req);
    expect(r.path).toBe('/v1/responses');
    expect(r.upstream).toBe(DEFAULT_UPSTREAM);
  });

  it('handles /v1/models path', () => {
    const req = new Request('http://localhost/v1/models');
    const r = routeConfig(req);
    expect(r.path).toBe('/v1/models');
  });

  // Edge cases: non-API paths should NOT be treated as model overrides
  it('does not extract model from /metrics path', () => {
    const req = new Request('http://localhost/metrics');
    const r = routeConfig(req);
    expect(r.path).toBe('/metrics');
    expect(r.modelOverride).toBeNull();
  });

  it('does not extract model from /health/upstream path', () => {
    const req = new Request('http://localhost/health/upstream');
    const r = routeConfig(req);
    expect(r.path).toBe('/health/upstream');
    expect(r.modelOverride).toBeNull();
  });

  it('does not extract model from /audit/log path', () => {
    const req = new Request('http://localhost/audit/log');
    const r = routeConfig(req);
    expect(r.path).toBe('/audit/log');
    expect(r.modelOverride).toBeNull();
  });

  it('does not extract model from /ws/v1/messages path', () => {
    const req = new Request('http://localhost/ws/v1/messages');
    const r = routeConfig(req);
    expect(r.path).toBe('/ws/v1/messages');
    expect(r.modelOverride).toBeNull();
  });

  it('still extracts model from /<model>/v1/messages', () => {
    const req = new Request('http://localhost/claude-sonnet-4/v1/messages');
    const r = routeConfig(req);
    expect(r.path).toBe('/v1/messages');
    expect(r.modelOverride).toBe('claude-sonnet-4');
  });
});

describe('getUpstream', () => {
  it('returns routeUpstream when no X-Upstream-Url header', () => {
    const req = new Request('http://localhost/v1/messages');
    expect(getUpstream(req, GO_UPSTREAM)).toBe(GO_UPSTREAM);
  });

  it('uses X-Upstream-Url header when present', () => {
    const req = new Request('http://localhost/v1/messages', {
      headers: { 'X-Upstream-Url': 'https://custom.example.com' },
    });
    expect(getUpstream(req, GO_UPSTREAM)).toBe('https://custom.example.com');
  });

  it('falls back to routeUpstream when X-Upstream-Url is invalid', () => {
    const req = new Request('http://localhost/v1/messages', {
      headers: { 'X-Upstream-Url': 'not-a-valid-url' },
    });
    expect(getUpstream(req, ZEN_UPSTREAM)).toBe(ZEN_UPSTREAM);
  });
});

describe('upstreamFormat', () => {
  it('defaults to openai', () => {
    const req = new Request('http://localhost/v1/messages');
    expect(upstreamFormat(req)).toBe('openai');
  });

  it('returns anthropic when header is set', () => {
    const req = new Request('http://localhost/v1/messages', {
      headers: { 'X-Upstream-Format': 'anthropic' },
    });
    expect(upstreamFormat(req)).toBe('anthropic');
  });

  it('is case-insensitive', () => {
    const req = new Request('http://localhost/v1/messages', {
      headers: { 'X-Upstream-Format': 'ANTHROPIC' },
    });
    expect(upstreamFormat(req)).toBe('anthropic');
  });
});

// ── Integration tests (end-to-end via worker.fetch) ──

describe('routing (integration)', () => {
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
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'X-Api-Key': key,
        'Anthropic-Version': '2023-06-01',
        'Anthropic-Beta': 'tools-2024-04-04',
      }),
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

  // Regression: root / endpoint returns full topology info WITHOUT requiring auth
  it('returns full info on root / when authenticated', async () => {
    const response = await worker.fetch(new Request('https://proxy.example/', {
      headers: { 'x-api-key': key },
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as { name: string; routes: unknown; endpoints: unknown };
    expect(body.name).toBe('opencode-cowork-proxy');
    expect(body.routes).toBeDefined();
    expect(body.endpoints).toBeDefined();
  });

  it('returns full info on root / WITHOUT authentication', async () => {
    const response = await worker.fetch(new Request('https://proxy.example/'));
    expect(response.status).toBe(200);
    const body = await response.json() as { name: string; routes: unknown; endpoints: unknown };
    expect(body.name).toBe('opencode-cowork-proxy');
    expect(body.routes).toBeDefined();
    expect(body.endpoints).toBeDefined();
  });
});
