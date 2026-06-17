import { describe, it, expect } from 'vitest';
import { log, __capture } from '../src/log/logger';
import {
  generateId,
  withContextIds,
  resolveContextIds,
  getRequestId,
  getTraceId,
  parseTraceparent,
} from '../src/log/context';

// ===== Error serialization tests =====

describe('error serialization', () => {
  it('serializes Error objects in details instead of {}', () => {
    const captured = __capture();

    try {
      log.error('TEST', 'Something broke', { error: new Error('Kaboom') });

      expect(captured.lines.length).toBe(1);
      const parsed = JSON.parse(captured.lines[0]);
      expect(parsed.details.error.message).toBe('Kaboom');
      expect(parsed.details.error.name).toBe('Error');
      expect(parsed.details.error.stack).toBeTypeOf('string');
    } finally {
      captured.restore();
    }
  });

  it('serializes nested Error cause', () => {
    const captured = __capture();

    try {
      const inner = new Error('Inner failure');
      const outer = new Error('Outer failure', { cause: inner });
      log.error('TEST', 'Chain', { error: outer });

      const parsed = JSON.parse(captured.lines[0]);
      expect(parsed.details.error.message).toBe('Outer failure');
      expect(parsed.details.error.cause.message).toBe('Inner failure');
    } finally {
      captured.restore();
    }
  });

  it('passes non-Error values through unchanged', () => {
    const captured = __capture();

    try {
      log.info('TEST', 'Stats', { count: 42, name: 'hello', active: true });

      const parsed = JSON.parse(captured.lines[0]);
      expect(parsed.details.count).toBe(42);
      expect(parsed.details.name).toBe('hello');
      expect(parsed.details.active).toBe(true);
    } finally {
      captured.restore();
    }
  });
});

// ===== __capture test helper =====

describe('__capture', () => {
  it('captures log output for testing', () => {
    const captured = __capture();

    try {
      log.info('TEST', 'Hello world', { key: 'value' });

      expect(captured.lines.length).toBe(1);
      const parsed = JSON.parse(captured.lines[0]);
      expect(parsed.level).toBe('INFO');
      expect(parsed.pfx).toBe('TEST');
      expect(parsed.msg).toBe('Hello world');
    } finally {
      captured.restore();
    }
  });

  it('does not capture after restore', () => {
    const captured1 = __capture();
    captured1.restore();

    // After restore, should not capture
    const captured2 = __capture();
    log.info('TEST', 'After restore');
    captured2.restore();

    expect(captured2.lines.length).toBe(1);
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

// ===== withContextIds / getRequestId / getTraceId tests =====

describe('logging context (trace_id + req)', () => {
  it('injects req and trace_id into captured log output', async () => {
    const captured = __capture();

    try {
      await withContextIds({ req: 'req-001', traceId: 'trace-A' }, async () => {
        log.info('AUTH', 'User logged in');
      });

      expect(captured.lines.length).toBe(1);
      const parsed = JSON.parse(captured.lines[0]);
      expect(parsed.req).toBe('req-001');
      expect(parsed.trace_id).toBe('trace-A');
    } finally {
      captured.restore();
    }
  });

  it('is undefined outside withContextIds context', () => {
    expect(getRequestId()).toBeUndefined();
    expect(getTraceId()).toBeUndefined();
  });

  it('restores previous context after nested withContextIds', async () => {
    const captured = __capture();

    try {
      await withContextIds({ req: 'outer', traceId: 'trace-outer' }, async () => {
        await withContextIds({ req: 'inner', traceId: 'trace-inner' }, async () => {
          log.info('NEST', 'Inside nested');
        });
        log.info('NEST', 'Back to outer');
      });

      expect(captured.lines.length).toBe(2);
      const inner = JSON.parse(captured.lines[0]);
      expect(inner.req).toBe('inner');
      expect(inner.trace_id).toBe('trace-inner');

      const outer = JSON.parse(captured.lines[1]);
      expect(outer.req).toBe('outer');
      expect(outer.trace_id).toBe('trace-outer');
    } finally {
      captured.restore();
    }
  });
});

// ===== resolveContextIds tests =====

describe('resolveContextIds', () => {
  it('uses X-Request-Id header for req', () => {
    const req = new Request('http://localhost', {
      headers: { 'X-Request-Id': 'client-req-456' },
    });
    const ids = resolveContextIds(req);
    expect(ids.req).toBe('client-req-456');
  });

  it('falls back to auto-generated req when no X-Request-Id', () => {
    const req = new Request('http://localhost');
    const ids = resolveContextIds(req);
    expect(ids.req).toBeTypeOf('string');
    expect(ids.req.length).toBe(8);
  });

  it('resolves trace_id from traceparent header', () => {
    const req = new Request('http://localhost', {
      headers: { traceparent: '00-abc123def4567890abcdef1234567890-0011223344556677-01' },
    });
    const ids = resolveContextIds(req);
    expect(ids.traceId).toBe('abc123def4567890abcdef1234567890');
  });

  it('resolves trace_id from X-Trace-Id header', () => {
    const req = new Request('http://localhost', {
      headers: { 'X-Trace-Id': 'my-session-001' },
    });
    const ids = resolveContextIds(req);
    expect(ids.traceId).toBe('my-session-001');
  });

  it('resolves trace_id from X-Request-Id when no traceparent or X-Trace-Id', () => {
    const req = new Request('http://localhost', {
      headers: { 'X-Request-Id': 'my-retry-001' },
    });
    const ids = resolveContextIds(req);
    expect(ids.traceId).toBe('my-retry-001');
  });

  it('is undefined when no client correlation header is sent', () => {
    const req = new Request('http://localhost');
    const ids = resolveContextIds(req);
    expect(ids.traceId).toBeUndefined();
  });

  it('traceparent takes priority over X-Trace-Id and X-Request-Id', () => {
    const req = new Request('http://localhost', {
      headers: {
        traceparent: '00-aaaabbbbccccddddeeeeffff00001111-0011223344556677-01',
        'X-Trace-Id': 'x-trace-header',
        'X-Request-Id': 'x-request-header',
      },
    });
    const ids = resolveContextIds(req);
    expect(ids.traceId).toBe('aaaabbbbccccddddeeeeffff00001111');
  });

  it('X-Trace-Id takes priority over X-Request-Id', () => {
    const req = new Request('http://localhost', {
      headers: {
        'X-Trace-Id': 'x-trace-header',
        'X-Request-Id': 'x-request-header',
      },
    });
    const ids = resolveContextIds(req);
    expect(ids.traceId).toBe('x-trace-header');
  });

  it('req and trace_id can differ (X-Request-Id used for both standalone)', () => {
    const req = new Request('http://localhost', {
      headers: {
        'X-Trace-Id': 'session-A',
        'X-Request-Id': 'req-001',
      },
    });
    const ids = resolveContextIds(req);
    expect(ids.traceId).toBe('session-A');
    expect(ids.req).toBe('req-001');
  });
});

// ===== parseTraceparent tests =====

describe('parseTraceparent', () => {
  it('extracts trace_id from valid header', () => {
    expect(parseTraceparent('00-abcdef1234567890abcdef1234567890-0011223344556677-01')).toBe('abcdef1234567890abcdef1234567890');
  });

  it('returns undefined for invalid header without dashes', () => {
    expect(parseTraceparent('abcdef')).toBeUndefined();
  });

  it('returns undefined for wrong number of fields', () => {
    expect(parseTraceparent('00-abcdef-00112233-01-extra')).toBeUndefined();
  });

  it('returns undefined for non-hex trace-id', () => {
    expect(parseTraceparent('00-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-0011223344556677-01')).toBeUndefined();
  });
});
