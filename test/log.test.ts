import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { log, __capture, generateId, withRequestId, getRequestId } from '../src/log';

// ===== Error serialization tests =====

describe('error serialization', () => {
  it('serializes Error objects in details instead of {}', () => {
    const captured: string[] = [];
    const restore = __capture({
      log(...args: unknown[]) { captured.push(String(args[0])); },
      error(...args: unknown[]) { captured.push(String(args[0])); },
      warn(...args: unknown[]) { captured.push(String(args[0])); },
    });

    try {
      log.error('TEST', 'Something broke', { error: new Error('Kaboom') });

      expect(captured.length).toBe(1);
      const parsed = JSON.parse(captured[0]);
      expect(parsed.details.error.message).toBe('Kaboom');
      expect(parsed.details.error.name).toBe('Error');
      expect(parsed.details.error.stack).toBeTypeOf('string');
    } finally {
      restore();
    }
  });

  it('serializes nested Error cause', () => {
    const captured: string[] = [];
    const restore = __capture({
      log(...args: unknown[]) { captured.push(String(args[0])); },
      error(...args: unknown[]) { captured.push(String(args[0])); },
      warn(...args: unknown[]) { captured.push(String(args[0])); },
    });

    try {
      const inner = new Error('Inner failure');
      const outer = new Error('Outer failure', { cause: inner });
      log.error('TEST', 'Chain', { error: outer });

      const parsed = JSON.parse(captured[0]);
      expect(parsed.details.error.message).toBe('Outer failure');
      expect(parsed.details.error.cause.message).toBe('Inner failure');
    } finally {
      restore();
    }
  });

  it('passes non-Error values through unchanged', () => {
    const captured: string[] = [];
    const restore = __capture({
      log(...args: unknown[]) { captured.push(String(args[0])); },
      error(...args: unknown[]) { captured.push(String(args[0])); },
      warn(...args: unknown[]) { captured.push(String(args[0])); },
    });

    try {
      log.info('TEST', 'Stats', { count: 42, name: 'hello', active: true });

      const parsed = JSON.parse(captured[0]);
      expect(parsed.details.count).toBe(42);
      expect(parsed.details.name).toBe('hello');
      expect(parsed.details.active).toBe(true);
    } finally {
      restore();
    }
  });
});

// ===== __capture test helper =====

describe('__capture', () => {
  it('captures log output for testing', () => {
    const captured: string[] = [];
    const restore = __capture({
      log(...args: unknown[]) { captured.push(String(args[0])); },
      error() {},
      warn() {},
    });

    try {
      log.info('TEST', 'Hello world', { key: 'value' });

      expect(captured.length).toBe(1);
      const parsed = JSON.parse(captured[0]);
      expect(parsed.level).toBe('INFO');
      expect(parsed.pfx).toBe('TEST');
      expect(parsed.msg).toBe('Hello world');
    } finally {
      restore();
    }
  });

  it('restores console output after restore', () => {
    const captured1: string[] = [];
    const restore = __capture({
      log(...args: unknown[]) { captured1.push(String(args[0])); },
      error() {},
      warn() {},
    });
    restore();

    // After restore, no capture
    const captured2: string[] = [];
    const restore2 = __capture({
      log(...args: unknown[]) { captured2.push(String(args[0])); },
      error() {},
      warn() {},
    });
    log.info('TEST', 'After restore');
    restore2();
    expect(captured2.length).toBe(1);
  });
});

// ===== generateId tests =====

describe('generateId', () => {
  it('produces an 8-char string', () => {
    const id = generateId();
    expect(id).toBeTypeOf('string');
    expect(id.length).toBe(8);
  });

  it('produces unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

// ===== withRequestId / getRequestId tests =====

describe('request ID context', () => {
  it('injects request ID into captured log output', async () => {
    const captured: string[] = [];
    const restore = __capture({
      log(...args: unknown[]) { captured.push(String(args[0])); },
      error() {},
      warn() {},
    });

    try {
      await withRequestId('test-123', async () => {
        log.info('AUTH', 'User logged in');
      });

      expect(captured.length).toBe(1);
      const parsed = JSON.parse(captured[0]);
      expect(parsed.req).toBe('test-123');
    } finally {
      restore();
    }
  });

  it('is undefined outside withRequestId context', () => {
    expect(getRequestId()).toBeUndefined();
  });
});
