/**
 * Backward-compatible re-export of the unified structured logger.
 *
 * The actual implementation has been refactored into src/log/:
 *   src/log/context.ts — Trace/request ID context (generateId, withContextIds,
 *                        resolveContextIds, getRequestId, getTraceId)
 *   src/log/logger.ts  — Core logger API (log object, types, filtering, output)
 *   src/log/index.ts   — Barrel export
 *
 * This file exists so all existing `import { log } from './logger'` continue
 * to work without modification. New code should import from './log' directly.
 */
export {
  log,
  generateId,
  withContextIds,
  resolveContextIds,
  getRequestId,
  getTraceId,
  currentTraceId,
  currentRequestId,
} from './log';
export type { LogLevel } from './log';
