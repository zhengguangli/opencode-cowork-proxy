/**
 * Log module barrel export.
 *
 * Re-exports:
 *   - log — Logger API (debug, info, warn, error, audit, access)
 *   - LogLevel, LogEntry — Type definitions
 *   - generateId, withRequestId, getRequestId — Request ID context
 *
 * WHEN TO READ THIS FILE: Adding a new log sub-module.
 *
 * For backward compatibility, src/logger.ts re-exports everything from here.
 */

export { log } from './logger';
export { generateId, withRequestId, getRequestId } from './context';
export type { LogLevel, LogEntry } from './logger';
