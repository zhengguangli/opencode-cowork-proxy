import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractApiKey, validateApiKey } from '../src/auth';
import worker from '../src/index';

const key = 'a'.repeat(32);

describe('extractApiKey', () => {
  it('extracts from X-Api-Key header', () => {
    expect(extractApiKey({ 'x-api-key': 'sk-test-key-32-chars-minimum-here' })).toBe('sk-test-key-32-chars-minimum-here');
  });

  it('extracts from Authorization Bearer header', () => {
    expect(extractApiKey({ 'authorization': 'Bearer sk-test-key-32-chars-minimum-here' })).toBe('sk-test-key-32-chars-minimum-here');
  });

  it('extracts from Authorization Token header (OpenAI SDK convention)', () => {
    expect(extractApiKey({ 'authorization': 'Token sk-test-key-32-chars-minimum-here' })).toBe('sk-test-key-32-chars-minimum-here');
  });

  it('prefers X-Api-Key over Authorization', () => {
    const result = extractApiKey({
      'x-api-key': 'sk-primary',
      'authorization': 'Bearer sk-secondary',
    });
    expect(result).toBe('sk-primary');
  });

  it('returns null when no key present', () => {
    expect(extractApiKey({})).toBeNull();
  });

  it('trims whitespace from Bearer token', () => {
    expect(extractApiKey({ 'authorization': 'Bearer   sk-key  ' })).toBe('sk-key');
  });
});

describe('validateApiKey', () => {
  it('returns null for valid key (32+ chars)', () => {
    expect(validateApiKey('a'.repeat(32))).toBeNull();
    expect(validateApiKey('a'.repeat(64))).toBeNull();
  });

  it('returns error for missing key', () => {
    const err = validateApiKey(null);
    expect(err).not.toBeNull();
    expect(err!.status).toBe(401);
    expect(err!.body).toHaveProperty('error');
  });

  it('returns error for short key (< 32 chars)', () => {
    const err = validateApiKey('short-key');
    expect(err).not.toBeNull();
    expect(err!.status).toBe(401);
  });
});

// ── Integration tests (end-to-end via worker.fetch) ──

describe('authentication (integration)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 for missing API key', async () => {
    const request = new Request('https://proxy.example/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }] }),
    });

    const response = await worker.fetch(request);
    expect(response.status).toBe(401);
    const body = await response.json() as { error: { type: string } };
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

  it('returns Anthropic error format on /v1/messages auth failure', async () => {
    const request = new Request('https://proxy.example/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const response = await worker.fetch(request);
    expect(response.status).toBe(401);
    const body = await response.json() as { type: string; error: { type: string } };
    expect(body.type).toBe('error');
    expect(body.error.type).toBe('authentication_error');
  });

  it('returns Anthropic error format on /v1/models auth failure', async () => {
    const request = new Request('https://proxy.example/go/v1/models', {
      headers: { 'x-upstream-format': 'anthropic' },
    });
    const response = await worker.fetch(request);
    expect(response.status).toBe(401);
    const body = await response.json() as { type?: string; error: { type: string } };
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
    const body = await response.json() as { type?: string; error: { type: string } };
    expect(body.type).toBeUndefined();
    expect(body.error.type).toBe('authentication_error');
  });
});
