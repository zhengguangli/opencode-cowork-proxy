/**
 * Backward-compatible re-export of the unified structured logger.
 *
 * The actual implementation has been refactored into src/log/:
 *   src/log/context.ts — Request ID context (generateId, withRequestId, getRequestId)
 *   src/log/logger.ts  — Core logger API (log object, types, filtering, output)
 *   src/log/index.ts   — Barrel export
 *
 * This file exists so all existing `import { log } from './logger'` continue
 * to work without modification. New code should import from './log' directly.
 */
export { log, generateId, withRequestId, getRequestId } from './log';
export type { LogLevel, LogEntry } from './log';
