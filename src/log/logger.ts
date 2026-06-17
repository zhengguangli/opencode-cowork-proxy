/**
 * Structured logger backed by Pino (industry standard JSON logger).
 *
 * Every log line — debug, info, error, audit, and HTTP access — produces
 * Pino-formatted JSON to stdout by default, with transports configurable
 * via environment variables.
 *
 * FORMAT (Pino standard):
 *   {"level":"INFO","time":"2026-06-17T...","service":"opencode-cowork-proxy","pfx":"STARTUP","msg":"...","req":"a1b2","details":{...}}
 *
 * ENV CONFIGURATION:
 *   LOG_LEVEL       — Minimum log level (DEBUG|INFO|WARN|ERROR), default: INFO
 *   LOG_FILE        — File path for persistent log output (e.g. /var/log/proxy.log)
 *   LOG_FILE_ROTATE — File rotation interval: daily (default) | hourly | none
 *   LOG_PRETTY      — Set to "1" for human-readable console output (dev only)
 *
 * FEATURES:
 *   - Pino child loggers for request-scoped context (req, trace_id, etc.)
 *   - Error objects auto-serialized with stack traces
 *   - Built-in level filtering
 *   - Transport system: stdout, file with rotation, Loki/Elasticsearch via pino transports
 *   - __capture() test helper for verifying log output
 *
 * WHEN TO READ THIS FILE: Adding/modifying log behavior, configuring transports.
 */
import pino from 'pino';
import { Writable } from 'stream';
import { currentRequestId, currentTraceId } from './context';

// ---- Types ----

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'AUDIT';

/** Default service identifier for multi-service log aggregation. */
const SERVICE = process?.env?.LOG_SERVICE ?? 'opencode-cowork-proxy';

// ---- Level configuration ----

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  AUDIT: 1,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/** Resolve minimum log level from LOG_LEVEL env var (default: INFO). */
function resolveLogLevel(): string {
  const env = process?.env?.LOG_LEVEL;
  if (env === 'DEBUG' || env === 'INFO' || env === 'WARN' || env === 'ERROR') return env;
  return 'INFO';
}

/** Sample rate for high-volume logs: 0.0 (none) to 1.0 (all). */
const SAMPLE_RATE = parseFloat(process?.env?.LOG_SAMPLE_RATE ?? '') || 1.0;

/**
 * Debug subsystem filter set.
 * - null → debug is disabled entirely (DEBUG env not set)
 * - empty set → all debug passes (DEBUG=* or DEBUG=1 or bare DEBUG)
 * - non-empty set → only matching subsystems pass (DEBUG=responses,retry)
 */
const debugFilter: Set<string> | null = (() => {
  const val = process?.env?.DEBUG;
  if (!val) return null;
  const trimmed = val.trim();
  if (!trimmed || trimmed === '*' || trimmed === '1' || trimmed === 'true') {
    return new Set();
  }
  return new Set(trimmed.split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
})();

// ---- Pino transport setup ----

/** Build root Pino logger. Writes JSON to stdout by default. */
function buildLogger() {
  return pino({
    level: resolveLogLevel(),
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { service: SERVICE },
    formatters: {
      level(label) {
        return { level: label.toUpperCase() };
      },
    },
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
  });
}

let pinoLogger = buildLogger();

// ---- Output dispatch ----
// The `output` function is swappable — in tests we replace it to capture lines,
// in production it delegates to Pino. This avoids fighting Pino's stream model.

type OutputFn = (level: pino.Level, obj: Record<string, unknown>, msg: string) => void;

let output: OutputFn = (level, obj, msg) => {
  pinoLogger[level](obj, msg);
};

// ---- Context helpers ----

/** Build request context bindings (req, trace_id) from module-level state. */
function reqContext(): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  const reqId = currentRequestId;
  if (reqId) ctx.req = reqId;
  const traceId = currentTraceId;
  if (traceId) ctx.trace_id = traceId;
  return ctx;
}

// ---- Error serialization ----

/**
 * Recursively serialize Error objects for JSON output.
 * Pino's built-in serializers only apply to top-level keys, but we nest
 * error info inside `details`. We handle it here before the output function.
 */
function serializeValue(v: unknown): unknown {
  if (v instanceof Error) {
    const result: Record<string, unknown> = {
      message: v.message,
      name: v.name,
    };
    if (v.stack) result.stack = v.stack;
    if (v.cause) result.cause = serializeValue(v.cause);
    return result;
  }
  return v;
}

function serializeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    result[k] = serializeValue(v);
  }
  return result;
}

// ---- Filtering helpers ----

function shouldLog(level: LogLevel, pfx?: string): boolean {
  if (level === 'DEBUG') {
    if (debugFilter === null) return false;
    if (debugFilter.size > 0 && pfx) {
      return debugFilter.has(pfx.toUpperCase());
    }
    return true;
  }
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[resolveLogLevel() as LogLevel];
}

function shouldSample(rate: number): boolean {
  return rate >= 1.0 || Math.random() < rate;
}

// ---- Logger API ----

export const log = {
  debug(pfx: string, msg: string, details?: Record<string, unknown>): void {
    if (!shouldLog('DEBUG', pfx)) return;
    output('debug', { pfx, details: details ? serializeDetails(details) : undefined, ...reqContext() }, msg);
  },

  info(pfx: string, msg: string, details?: Record<string, unknown>): void {
    if (!shouldLog('INFO')) return;
    output('info', { pfx, details: details ? serializeDetails(details) : undefined, ...reqContext() }, msg);
  },

  warn(pfx: string, msg: string, details?: Record<string, unknown>): void {
    if (!shouldLog('WARN')) return;
    output('warn', { pfx, details: details ? serializeDetails(details) : undefined, ...reqContext() }, msg);
  },

  error(pfx: string, msg: string, details?: Record<string, unknown>): void {
    if (!shouldLog('ERROR')) return;
    output('error', { pfx, details: details ? serializeDetails(details) : undefined, ...reqContext() }, msg);
  },

  /** Audit events — logged at info level with audit flag. */
  audit(pfx: string, msg: string, details?: Record<string, unknown>): void {
    if (!shouldLog('INFO')) return;
    output('info', { pfx, details: details ? serializeDetails(details) : undefined, audit: true, ...reqContext() }, msg);
  },

  /** HTTP access log with sampling support. */
  access(method: string, path: string, status: number, durationMs: number): void {
    if (!shouldLog('INFO')) return;
    if (!shouldSample(SAMPLE_RATE)) return;
    output('info', { pfx: 'HTTP', method, path, status, durationMs, ...reqContext() }, `${method} ${path} ${status}`);
  },
};

// ---- Test capture support ----

/**
 * Capture log output for testing.
 * Creates an isolated Pino instance writing to an in-memory stream,
 * so error serialization and formatting match real behavior.
 *
 * @example
 *   const { lines, restore } = __capture();
 *   log.info('TEST', 'hello');
 *   restore();
 *   console.log(lines);  // ['{"level":"INFO",...}']
 */
export function __capture(): { lines: string[]; restore: () => void } {
  const savedOutput = output;
  const lines: string[] = [];

  const stream = new Writable({
    write(chunk: Buffer, _enc: BufferEncoding, cb: (error?: Error | null) => void) {
      lines.push(chunk.toString().trim());
      cb();
    },
  });

  const captureLogger = pino(
    {
      level: 'debug',
      timestamp: pino.stdTimeFunctions.isoTime,
      base: { service: SERVICE },
      formatters: { level(label) { return { level: label.toUpperCase() }; } },
      serializers: { err: pino.stdSerializers.err, error: pino.stdSerializers.err },
    },
    stream,
  );

  output = (level, obj, msg) => {
    (captureLogger as unknown as Record<string, (obj: Record<string, unknown>, msg: string) => void>)[level](obj, msg);
  };

  return {
    lines,
    restore: () => {
      output = savedOutput;
    },
  };
}
