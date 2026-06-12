/**
 * Structured audit logging for security-relevant events.
 *
 * WHEN TO READ THIS FILE: Adding a new audit event type, changing audit
 * output format, or debugging audit trail issues.
 *
 * Audit events are JSON-per-line (stdout) AND buffered in-memory for the
 * /audit/log endpoint. The buffer retains the last 1000 events.
 *
 * Audit logging is ALWAYS on — not gated by DEBUG.
 */
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

function ts(): string {
  return new Date().toISOString();
}

function emit(event: AuditEvent): void {
  const line = JSON.stringify({ audit: true, ...event });
  console.log(line);
  bufferEvent(event);
}

/** Record a generic audit event. */
export function recordAudit(type: AuditEventType, action: string, details: Record<string, unknown>): void {
  emit({ ts: ts(), type, action, details });
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
