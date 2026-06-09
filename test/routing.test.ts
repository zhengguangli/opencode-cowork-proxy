import { describe, it, expect } from 'vitest';
import { routeConfig, getUpstream, upstreamFormat } from '../src/routing';
import { GO_UPSTREAM, ZEN_UPSTREAM, DEFAULT_UPSTREAM } from '../src/config';

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
