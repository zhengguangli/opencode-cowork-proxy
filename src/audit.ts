/**
 * Structured audit logging for security-relevant events.
 *
 * WHY READ THIS FILE: Audit events capture security-relevant operations.
 * They're ALWAYS ON (not gated by DEBUG) and both written through logger.ts
 * AND buffered in-memory for the /audit/log endpoint.
 *
 * RELATIONSHIP WITH logger.ts:
 *   audit.ts uses log.audit() from logger.ts to produce unified log lines.
 *   The format is identical to other log lines:
 *     {"level":"AUDIT","ts":"...","pfx":"AUTH","msg":"authenticated","details":{...}}
 *   This is the ONLY difference: audit events are logged at the AUDIT level
 *   so log aggregators can filter them separately.
 *
 * The in-memory ring buffer (1000 events) is separate from the log output
 * and serves the GET /audit/log endpoint for real-time debugging.
 */
import { log } from './logger';
import { identifyKeyType } from './auth';

export type AuditEventType = 'auth' | 'upstream' | 'model' | 'error' | 'stream' | 'proxy';

export interface AuditEvent {
  ts: string;
  type: AuditEventType;
  action: string;
  details: Record<string, unknown>;
}

// ---- Ring buffer for /audit/log ----

const MAX_BUFFERED = 1000;
const eventBuffer: AuditEvent[] = [];

function bufferEvent(event: AuditEvent): void {
  eventBuffer.push(event);
  if (eventBuffer.length > MAX_BUFFERED) {
    eventBuffer.shift();
  }
}

/** Get a snapshot of recent audit events (newest last). */
export function getRecentAuditEvents(limit = 200): AuditEvent[] {
  return eventBuffer.slice(-limit);
}

// ---- Core ----

const PREFIX_MAP: Record<AuditEventType, string> = {
  auth: 'AUTH',
  upstream: 'UPSTREAM',
  model: 'MODEL',
  error: 'ERROR',
  stream: 'STREAM',
  proxy: 'PROXY',
};

function ts(): string {
  return new Date().toISOString();
}

/** Record a generic audit event — writes through logger.ts AND buffers for /audit/log. */
export function recordAudit(type: AuditEventType, action: string, details: Record<string, unknown>): void {
  const event: AuditEvent = { ts: ts(), type, action, details };
  // Write through unified logger
  log.audit(PREFIX_MAP[type], action, details);
  // Buffer for /audit/log endpoint
  bufferEvent(event);
}

// ---- Typed helpers ----

export function auditAuth(key: string | null, path: string, success: boolean, errorMessage?: string): void {
  const keyType = key ? identifyKeyType(key) : 'none';
  const maskedKey = key ? `${key.slice(0, 8)}...${key.slice(-4)}` : null;
  recordAudit('auth', success ? 'authenticated' : 'auth_failed', {
    path, key_type: keyType, key_prefix: maskedKey, error: errorMessage || null,
  });
}

export function auditUpstreamSwitch(path: string, fromUrl: string, toUrl: string, source: 'header' | 'prefix'): void {
  recordAudit('upstream', 'switch', { path, from: fromUrl, to: toUrl, source });
}

export function auditModelOverride(path: string, originalModel: string | null | undefined, finalModel: string, reason: 'url' | 'vision' | 'thinking' | 'none'): void {
  recordAudit('model', `override_${reason}`, {
    path, original_model: originalModel ?? '(none)', final_model: finalModel, reason,
  });
}

export function auditError(action: string, upstream: string, status: number, message: string): void {
  recordAudit('error', action, { upstream, status, message: message.slice(0, 500) });
}

export function auditStream(path: string, action: 'start' | 'end' | 'abort', model?: string): void {
  recordAudit('stream', action, { path, model: model ?? '(unknown)' });
}
