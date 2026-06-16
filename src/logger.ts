/**
 * Unified structured logger for opencode-cowork-proxy.
 *
 * WHY READ THIS FILE: This is THE ONE logging module for the entire project.
 * Every log line — debug, info, error, audit, and HTTP access — goes through
 * this module and produces the SAME JSON format. No more hunting for
 * plain console.log() scattered across handlers.
 *
 * FORMAT (all levels):
 *   {"level":"INFO","ts":"...","pfx":"STARTUP","msg":"...","req":"a1b2c3d4","details":{...}}
 *
 * The `req` field is populated automatically when the request is wrapped with
 * `withRequestId()`. It correlates all logs from the same request.
 *
 * CF WORKERS COMPAT: Uses a simple module-level variable instead of
 * AsyncLocalStorage. Each isolate handles one request at a time, so a
 * mutable variable is safe and avoids CF Workers' lack of ALS support.
 *
 * LEVELS:
 *   DEBUG — gated by IS_DEBUG (config.ts), silent in production
 *   INFO  — standard operational info (including HTTP access logs)
 *   WARN  — warnings that need attention
 *   ERROR — errors requiring immediate attention
 *   AUDIT — security/audit events (always on, same priority as INFO)
 *
 * SAMPLING:
 *   High-volume log types (access logs) support sampleRate.
 *   sampleRate=1 → every request logged (default)
 *   sampleRate=0.1 → 10% of requests logged
 *
 *   Set via LOG_SAMPLE_RATE env var (number 0-1).
 *
 * PREFIX CONVENTION:
 *   HTTP      — HTTP access logs
 *   STARTUP   — startup initialization
 *   SERVER    — generic server errors
 *   AUTH      — authentication events
 *   MODELS    — model list operations
 *   RESPONSES — Responses API handler
 *   RETRY     — upstream retry events
 *   RATELIMIT — rate-limit tracking
 *   COMPRESS  — compression operations
 *   STREAM    — stream lifecycle
 *   WS        — WebSocket events
 *
 * Pure module — no I/O beyond console.*, safe for all deployment targets.
 */
import { IS_DEBUG } from './config';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'AUDIT';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  AUDIT: 1,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const MIN_LOG_LEVEL: LogLevel = 'INFO';

/** Sample rate for high-volume logs: 0.0 (none) to 1.0 (all). */
const SAMPLE_RATE = parseFloat(process?.env?.LOG_SAMPLE_RATE ?? '') || 1.0;

// ---- Request ID (CF Workers compatible) ----
// CF Workers don't support AsyncLocalStorage, but each isolate processes
// one request at a time — a mutable variable is safe and portable.

/**
 * Per-request context — populated by withRequestId().
 * Replaces AsyncLocalStorage for CF Workers compatibility.
 */
let currentRequestId: string | undefined;

export interface LogEntry {
  level: LogLevel;
  ts: string;
  pfx: string;
  msg: string;
  details?: Record<string, unknown>;
}

function shouldLog(level: LogLevel): boolean {
  if (level === 'DEBUG') return !!IS_DEBUG;
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LOG_LEVEL];
}

/** Check if a sampled log line should be emitted. */
function shouldSample(rate: number): boolean {
  return rate >= 1.0 || Math.random() < rate;
}

function write(entry: LogEntry): void {
  const payload: Record<string, unknown> = {
    level: entry.level,
    ts: entry.ts,
    pfx: entry.pfx,
    msg: entry.msg,
  };
  if (currentRequestId) {
    payload.req = currentRequestId;
  }
  if (entry.details && Object.keys(entry.details).length > 0) {
    payload.details = entry.details;
  }

  const line = JSON.stringify(payload);

  switch (entry.level) {
    case 'ERROR':
      console.error(line);
      break;
    case 'WARN':
      console.warn(line);
      break;
    default:
      console.log(line);
  }
}

function ts(): string {
  return new Date().toISOString();
}

/** Generate a short unique request ID */
export function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/**
 * Wrap an async operation with a request_id in the logging context.
 * Uses a module-level variable instead of AsyncLocalStorage for
 * CF Workers compatibility.
 */
export async function withRequestId<T>(requestId: string, fn: () => Promise<T>): Promise<T> {
  const prev = currentRequestId;
  currentRequestId = requestId;
  try {
    return await fn();
  } finally {
    currentRequestId = prev;
  }
}

/** Get the current request ID (for passing to sub-systems). */
export function getRequestId(): string | undefined {
  return currentRequestId;
}

export const log = {
  debug(pfx: string, msg: string, details?: Record<string, unknown>): void {
    if (!shouldLog('DEBUG')) return;
    write({ level: 'DEBUG', ts: ts(), pfx, msg, details });
  },

  info(pfx: string, msg: string, details?: Record<string, unknown>): void {
    if (!shouldLog('INFO')) return;
    write({ level: 'INFO', ts: ts(), pfx, msg, details });
  },

  warn(pfx: string, msg: string, details?: Record<string, unknown>): void {
    if (!shouldLog('WARN')) return;
    write({ level: 'WARN', ts: ts(), pfx, msg, details });
  },

  error(pfx: string, msg: string, details?: Record<string, unknown>): void {
    if (!shouldLog('ERROR')) return;
    write({ level: 'ERROR', ts: ts(), pfx, msg, details });
  },

  /** Audit events — always on, not gated by DEBUG. */
  audit(pfx: string, msg: string, details?: Record<string, unknown>): void {
    if (!shouldLog('AUDIT')) return;
    write({ level: 'AUDIT', ts: ts(), pfx, msg, details });
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
    write({
      level: 'INFO',
      ts: ts(),
      pfx: 'HTTP',
      msg: `${method} ${path} ${status}`,
      details: { method, path, status, durationMs },
    });
  },
};
