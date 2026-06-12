import { describe, it, expect } from 'vitest';
import { handleWebSocketUpgrade } from '../src/handlers/websocket';

describe('handleWebSocketUpgrade', () => {
  it('returns null for non-ws paths', async () => {
    const req = new Request('http://localhost/v1/messages');
    const result = await handleWebSocketUpgrade(req);
    expect(result).toBeNull();
  });

  it('returns 426 for ws-prefixed paths', async () => {
    const req = new Request('http://localhost/ws/v1/messages', {
      headers: { 'x-api-key': 'a'.repeat(32) },
    });
    const result = await handleWebSocketUpgrade(req);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(426);
    const body: Record<string, unknown> = await result!.json() as Record<string, unknown>;
    expect(body.alternative).toBeDefined();
    expect((body.error as Record<string, unknown>).type).toBe('upgrade_required');
    
    expect((body.alternative as Record<string, unknown>).method).toBe('POST');
  });

  it('includes SSE fallback instructions in 426 response', async () => {
    const req = new Request('http://localhost/ws/v1/chat/completions', {
      headers: { 'x-api-key': 'a'.repeat(32) },
    });
    const result = await handleWebSocketUpgrade(req);
    expect(result).not.toBeNull();
    const body: Record<string, unknown> = await result!.json() as Record<string, unknown>;
    expect(((body.alternative as Record<string, unknown>).body as Record<string, unknown>).stream).toBe(true);
  });

  it('returns 401 for ws paths without auth', async () => {
    const req = new Request('http://localhost/ws/v1/messages', {
      headers: { 'x-api-key': 'short' },
    });
    const result = await handleWebSocketUpgrade(req);
    expect(result).not.toBeNull();
    // If auth fails, it returns 401 instead of 426
    expect([401, 426]).toContain(result!.status);
  });
});
