import { describe, it, expect } from 'vitest';
import { extractApiKey, validateApiKey, identifyKeyType } from '../src/auth';

describe('identifyKeyType', () => {
  it('identifies Anthropic keys', () => {
    expect(identifyKeyType('sk-ant-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe('anthropic');
  });

  it('identifies OpenCode keys starting with sk-', () => {
    expect(identifyKeyType('sk-' + 'a'.repeat(30))).toBe('opencode');
  });

  it('identifies OpenCode keys starting with pk-', () => {
    expect(identifyKeyType('pk-' + 'a'.repeat(30))).toBe('opencode');
  });

  it('identifies generic long keys', () => {
    expect(identifyKeyType('a'.repeat(40))).toBe('generic-long');
  });

  it('identifies generic keys', () => {
    expect(identifyKeyType('a'.repeat(32))).toBe('generic');
  });
});

describe('validateApiKey format check', () => {
  it('rejects key with spaces', () => {
    const err: { status: number; body: Record<string, unknown> } | null = validateApiKey('a'.repeat(30) + ' ' + 'a');
    expect(err).not.toBeNull();
    expect(err!.status).toBe(401);
    expect((err!.body.error as Record<string, unknown>).message).toContain('Invalid API key format');
  });

  it('rejects key with special characters', () => {
    const err: { status: number; body: Record<string, unknown> } | null = validateApiKey('a'.repeat(20) + '!!!' + 'a'.repeat(10));
    expect(err).not.toBeNull();
    expect(err!.status).toBe(401);
  });

  it('rejects key with newline', () => {
    const err: { status: number; body: Record<string, unknown> } | null = validateApiKey('a'.repeat(30) + '\n' + 'a');
    expect(err).not.toBeNull();
  });

  it('accepts valid base64url key', () => {
    const err: { status: number; body: Record<string, unknown> } | null = validateApiKey('a'.repeat(32));
    expect(err).toBeNull();
  });

  it('accepts valid OpenCode-style key', () => {
    const err: { status: number; body: Record<string, unknown> } | null = validateApiKey('sk-' + 'a'.repeat(30));
    expect(err).toBeNull();
  });

  it('accepts key with underscores', () => {
    const err: { status: number; body: Record<string, unknown> } | null = validateApiKey('sk-test_key_' + 'a'.repeat(22));
    expect(err).toBeNull();
  });

  it('accepts key with dashes', () => {
    const err: { status: number; body: Record<string, unknown> } | null = validateApiKey('sk-test-key-' + 'a'.repeat(22));
    expect(err).toBeNull();
  });
});
