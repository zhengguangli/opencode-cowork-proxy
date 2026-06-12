/**
 * Unified structured logger for opencode-cowork-proxy.
 *
 * WHY READ THIS FILE: This is THE ONE logging module for the entire project.
 * Every log line — debug, info, error, audit, and HTTP access — goes through
 * this module and produces the SAME JSON format. No more hunting for
 * plain console.log() scattered across handlers.
 *
 * FORMAT (all levels):
 *   {"level":"INFO","ts":"2026-06-12T07:56:17.346Z","pfx":"STARTUP","msg":"Plugin init in 0ms","details":{...}}
 *
 * LEVELS:
 *   DEBUG — gated by IS_DEBUG (config.ts), silent in production
 *   INFO  — standard operational info (including HTTP access logs)
 *   WARN  — warnings that need attention
 *   ERROR — errors requiring immediate attention
 *   AUDIT — security/audit events (always on, same priority as INFO)
 *
 * PREFIX CONVENTION:
 *   HTTP      — HTTP access logs (from build-entry.ts)
 *   STARTUP   — startup initialization
 *   AUTH      — authentication events
 *   MODELS    — model list operations
 *   RESPONSES — Responses API handler
 *   RETRY     — upstream retry events
 *   RATELIMIT — rate-limit tracking
 *   COMPRESS  — compression operations
 *   STREAM    — stream lifecycle
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

function write(entry: LogEntry): void {
  const payload: Record<string, unknown> = {
    level: entry.level,
    ts: entry.ts,
    pfx: entry.pfx,
    msg: entry.msg,
  };
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

  /** Audit events — always on, not gated by DEBUG. Shorthand for info level with AUDIT semantic. */
  audit(pfx: string, msg: string, details?: Record<string, unknown>): void {
    if (!shouldLog('AUDIT')) return;
    write({ level: 'AUDIT', ts: ts(), pfx, msg, details });
  },

  /** HTTP access log — convenience for structured access logging. */
  access(method: string, path: string, status: number, durationMs: number): void {
    if (!shouldLog('INFO')) return;
    write({
      level: 'INFO',
      ts: ts(),
      pfx: 'HTTP',
      msg: `${method} ${path} ${status} ${durationMs}ms`,
      details: { method, path, status, durationMs },
    });
  },
};
