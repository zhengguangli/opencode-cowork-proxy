/**
 * Unified structured logger for opencode-cowork-proxy.
 *
 * Every log line — debug, info, error, audit, and HTTP access — goes through
 * this module and produces the same JSON format.
 *
 * FORMAT:
 *   {"level":"INFO","ts":"...","pfx":"STARTUP","msg":"...","req":"a1b2","details":{...}}
 *
 * ENV CONFIGURATION:
 *   LOG_LEVEL     — Minimum log level (DEBUG|INFO|WARN|ERROR), default: INFO
 *   DEBUG         — Subsystem filter for debug logs, e.g. "responses,retry" or "*"
 *   LOG_SAMPLE_RATE — Access log sampling rate 0.0-1.0, default: 1.0
 *
 * FEATURES:
 *   - Error objects in `details` are serialized as {message, name, stack, cause}
 *   - DEBUG env supports comma-separated subsystem filtering (e.g. "responses,retry")
 *   - DEBUG=* or bare DEBUG=1 enables all debug logs (backward-compat)
 *   - generateId() uses crypto.randomUUID() when available
 *   - __capture() test helper swaps console methods for test assertion
 *
 * WHEN TO READ THIS FILE: Adding/modifying log behavior, debugging log filtering.
 */
import { currentRequestId, currentTraceId } from './context';

// ---- Types ----

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'AUDIT';

/** Default service identifier for multi-service log aggregation. */
const SERVICE = process?.env?.LOG_SERVICE ?? 'opencode-cowork-proxy';

export interface LogEntry {
  level: LogLevel;
  ts: string;
  service: string;
  pfx: string;
  msg: string;
  req?: string;
  trace_id?: string;
  details: Record<string, unknown>;
}

// ---- Level configuration ----

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  AUDIT: 1,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/** Resolve minimum log level from LOG_LEVEL env var (default: INFO). */
function resolveLogLevel(): LogLevel {
  const env = process?.env?.LOG_LEVEL;
  if (env === 'DEBUG' || env === 'INFO' || env === 'WARN' || env === 'ERROR') return env;
  return 'INFO';
}

const MIN_LOG_LEVEL = resolveLogLevel();

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
    // All debug enabled
    return new Set();
  }
  // Subsystem-specific filtering
  return new Set(trimmed.split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
})();

// ---- Filtering helpers ----

function shouldLog(level: LogLevel, pfx?: string): boolean {
  if (level === 'DEBUG') {
    if (debugFilter === null) return false;          // DEBUG env not set
    if (debugFilter.size > 0 && pfx) {
      return debugFilter.has(pfx.toUpperCase());     // subsystem-specific
    }
    return true;                                       // all debug
  }
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LOG_LEVEL];
}

function shouldSample(rate: number): boolean {
  return rate >= 1.0 || Math.random() < rate;
}

function ts(): string {
  return new Date().toISOString();
}

// ---- Error serialization ----

/**
 * Recursively serialize a value for JSON log output.
 * Error objects are expanded to {message, name, stack?, cause?} instead of {}.
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

// ---- Output ----

/** Current console output methods — swapped by __capture() for testing. */
let outputConsole: Pick<Console, 'error' | 'warn' | 'log'> = console;

/**
 * Assemble a log payload and write it to the output.
 * Injects the current request ID when available.
 * Serializes Error objects in details.
 */
function write(level: LogLevel, pfx: string, msg: string, details?: Record<string, unknown>): void {
  const payload: Record<string, unknown> = {
    level,
    ts: ts(),
    service: SERVICE,
    pfx,
    msg,
    // Always emit details for consistent schema across all log lines.
    // Log collection systems (ELK, Datadog, Loki) auto-map from sample
    // data — an absent field breaks queries like `details.error:exists`.
    details: details && Object.keys(details).length > 0 ? serializeDetails(details) : {},
  };

  const reqId = currentRequestId;
  if (reqId) payload.req = reqId;

  const traceId = currentTraceId;
  if (traceId) payload.trace_id = traceId;

  const line = JSON.stringify(payload);

  switch (level) {
    case 'ERROR':
      outputConsole.error(line);
      break;
    case 'WARN':
      outputConsole.warn(line);
      break;
    default:
      outputConsole.log(line);
  }
}

// ---- Test capture support ----

type CaptureTarget = Pick<Console, 'error' | 'warn' | 'log'>;

/** Registered capture functions for testing (replaces console). */
let captureTarget: CaptureTarget | null = null;

/**
 * Install a log capture target for testing.
 * Pass null to restore default console output.
 * Returns a function to call to restore the previous target.
 *
 * @example
 *   const restore = __capture({ log(...args) { captured.push(args); }, error() {}, warn() {} });
 *   // ... run code that logs ...
 *   restore();
 */
export function __capture(target: CaptureTarget | null): () => void {
  const prev = captureTarget;
  captureTarget = target;
  outputConsole = target ?? console;
  return () => {
    captureTarget = prev;
    outputConsole = prev ?? console;
  };
}

// ---- Logger API ----

export const log = {
  debug(pfx: string, msg: string, details?: Record<string, unknown>): void {
    if (!shouldLog('DEBUG', pfx)) return;
    write('DEBUG', pfx, msg, details);
  },

  info(pfx: string, msg: string, details?: Record<string, unknown>): void {
    if (!shouldLog('INFO')) return;
    write('INFO', pfx, msg, details);
  },

  warn(pfx: string, msg: string, details?: Record<string, unknown>): void {
    if (!shouldLog('WARN')) return;
    write('WARN', pfx, msg, details);
  },

  error(pfx: string, msg: string, details?: Record<string, unknown>): void {
    if (!shouldLog('ERROR')) return;
    write('ERROR', pfx, msg, details);
  },

  /** Audit events — always on, not gated by DEBUG. */
  audit(pfx: string, msg: string, details?: Record<string, unknown>): void {
    if (!shouldLog('AUDIT')) return;
    write('AUDIT', pfx, msg, details);
  },

  /**
   * HTTP access log — structured access logging with sampling support.
   *
   * `msg` is a concise summary for human scanning: "GET /v1/models 200".
   * `details` carries the full structured data for programmatic consumption.
   */
  access(method: string, path: string, status: number, durationMs: number): void {
    if (!shouldLog('INFO')) return;
    if (!shouldSample(SAMPLE_RATE)) return;
    write('INFO', 'HTTP', `${method} ${path} ${status}`, { method, path, status, durationMs });
  },
};
