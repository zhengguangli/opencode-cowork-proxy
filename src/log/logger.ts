/**
 * Unified structured logger for opencode-cowork-proxy.
 *
 * Every log line — debug, info, error, audit, and HTTP access — goes through
 * this module and produces the same JSON format.
 *
 * FORMAT:
 *   {"level":"INFO","ts":"...","pfx":"STARTUP","msg":"...","req":"a1b2","details":{...}}
 *
 * The `req` field is populated automatically from the request ID context
 * (managed in ./context.ts). This correlates all logs from the same request.
 *
 * LEVELS:
 *   DEBUG — gated by IS_DEBUG (config.ts), silent in production
 *   INFO  — standard operational info (including HTTP access logs)
 *   WARN  — warnings that need attention
 *   ERROR — errors requiring immediate attention
 *   AUDIT — security/audit events (always on, same priority as INFO)
 *
 * SAMPLING:
 *   log.access() supports sampleRate (LOG_SAMPLE_RATE env var, 0.0-1.0).
 *   Default: 1.0 (every request logged).
 *
 * WHEN TO READ THIS FILE: Adding a new log method, modifying log output format,
 * or debugging log filtering/sampling behavior.
 *
 * PREFIX CONVENTION (alphabetical):
 *   AUTH      — authentication events
 *   COMPRESS  — compression operations
 *   HTTP      — HTTP access logs (via log.access())
 *   MODELS    — model list operations
 *   RATELIMIT — rate-limit tracking
 *   RESPONSES — Responses API handler
 *   RETRY     — upstream retry events
 *   SERVER    — generic server errors
 *   STARTUP   — startup initialization
 *   STREAM    — stream lifecycle
 *   WS        — WebSocket events
 */
import { IS_DEBUG } from '../config';
import { currentRequestId } from './context';

// ---- Types ----

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'AUDIT';

export interface LogEntry {
  level: LogLevel;
  ts: string;
  pfx: string;
  msg: string;
  details?: Record<string, unknown>;
}

// ---- Level configuration ----

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

// ---- Filtering helpers ----

function shouldLog(level: LogLevel): boolean {
  if (level === 'DEBUG') return !!IS_DEBUG;
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LOG_LEVEL];
}

function shouldSample(rate: number): boolean {
  return rate >= 1.0 || Math.random() < rate;
}

function ts(): string {
  return new Date().toISOString();
}

// ---- Output ----

/**
 * Assemble a log payload and write it to the console.
 * Injects the current request ID when available.
 */
function write(level: LogLevel, pfx: string, msg: string, details?: Record<string, unknown>): void {
  const payload: Record<string, unknown> = {
    level,
    ts: ts(),
    pfx,
    msg,
  };

  const reqId = currentRequestId;
  if (reqId) payload.req = reqId;
  if (details && Object.keys(details).length > 0) payload.details = details;

  const line = JSON.stringify(payload);

  switch (level) {
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

// ---- Logger API ----

export const log = {
  debug(pfx: string, msg: string, details?: Record<string, unknown>): void {
    if (!shouldLog('DEBUG')) return;
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
