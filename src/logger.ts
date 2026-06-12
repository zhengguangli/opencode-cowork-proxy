/**
 * Structured logger for opencode-cowork-proxy.
 *
 * WHEN TO READ THIS FILE: Adding a new log level, changing log output format,
 * or debugging why certain logs appear/disappear.
 *
 * Design:
 * - Log levels: DEBUG | INFO | WARN | ERROR
 * - DEBUG level is gated by IS_DEBUG (config.ts) — silent in production by default
 * - Output is JSON-per-line for Cloudflare Workers log queryability
 * - Prefix system replaces ad-hoc tags like [RETRY], [RESPONSES]
 * - Pure module — no I/O beyond console.*, safe for all deployment targets
 */

import { IS_DEBUG } from './config';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const MIN_LOG_LEVEL: LogLevel = 'INFO';

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  prefix: string;
  message: string;
  data?: unknown[];
}

function shouldLog(level: LogLevel): boolean {
  if (level === 'DEBUG') return !!IS_DEBUG;
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LOG_LEVEL];
}

function write(entry: LogEntry): void {
  const line = JSON.stringify({
    level: entry.level,
    ts: entry.timestamp,
    pfx: entry.prefix,
    msg: entry.message,
  });

  switch (entry.level) {
    case 'ERROR':
      console.error(line, ...(entry.data ?? []));
      break;
    case 'WARN':
      console.warn(line, ...(entry.data ?? []));
      break;
    default:
      console.log(line, ...(entry.data ?? []));
  }
}

function ts(): string {
  return new Date().toISOString();
}

export const log = {
  debug(prefix: string, message: string, ...data: unknown[]): void {
    if (!shouldLog('DEBUG')) return;
    write({ level: 'DEBUG', timestamp: ts(), prefix, message, data: data.length ? data : undefined });
  },

  info(prefix: string, message: string, ...data: unknown[]): void {
    if (!shouldLog('INFO')) return;
    write({ level: 'INFO', timestamp: ts(), prefix, message, data: data.length ? data : undefined });
  },

  warn(prefix: string, message: string, ...data: unknown[]): void {
    if (!shouldLog('WARN')) return;
    write({ level: 'WARN', timestamp: ts(), prefix, message, data: data.length ? data : undefined });
  },

  error(prefix: string, message: string, ...data: unknown[]): void {
    if (!shouldLog('ERROR')) return;
    write({ level: 'ERROR', timestamp: ts(), prefix, message, data: data.length ? data : undefined });
  },
};
