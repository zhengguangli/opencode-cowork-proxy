/**
 * Logging context management for structured logging — trace_id + request_id.
 *
 * TWO-LEVEL TRACKING:
 *   trace_id — Stable session/trace identifier. Same across all requests in a
 *              logical conversation (client retries, multi-turn chat). Resolved
 *              from client headers with fallback to auto-generation.
 *   req      — Per-request unique identifier. Usually auto-generated, but
 *              respects client-provided X-Request-Id for retry correlation.
 *
 * HEADER RESOLUTION ORDER (trace_id):
 *   1. traceparent   — W3C Trace Context (extract 32-char trace-id hex)
 *   2. X-Trace-Id    — Custom trace/session header
 *   3. X-Request-Id  — Client request ID (stable across retries)
 *   4. Auto-generated
 *
 * HEADER RESOLUTION ORDER (req):
 *   1. X-Request-Id  — Client-provided request ID (for retry correlation)
 *   2. Auto-generated
 *
 * Cloudflare Workers do not support AsyncLocalStorage. Each isolate processes
 * one request at a time, so mutable module-level variables are safe.
 *
 * WHEN TO READ THIS FILE: Modifying trace/session tracking, ID resolution,
 * or context propagation.
 *
 * Exports:
 *   generateId()          — Generate a short unique ID (8 chars)
 *   resolveContextIds()   — Resolve trace_id + req from request headers
 *   withContextIds()      — Wrap async op with trace_id + req context
 *   getRequestId()        — Get current per-request ID
 *   getTraceId()          — Get current trace/session ID
 *   currentRequestId      — Module-level variable
 *   currentTraceId        — Module-level variable
 */

/** Per-request ID — populated by withContextIds(), read by logger.ts write(). */
export let currentRequestId: string | undefined;

/** Trace/session ID — populated by withContextIds(), read by logger.ts write(). */
export let currentTraceId: string | undefined;

/**
 * Generate a short unique ID (8 chars).
 * Uses crypto.randomUUID() when available, falls back to Math.random() + Date.now().
 */
export function generateId(): string {
  try {
    // @ts-ignore — crypto.randomUUID() available in modern runtimes
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().slice(0, 8);
    }
  } catch {
    // Fall through
  }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/**
 * Parse W3C traceparent header (format: "00-{trace_id_32hex}-{span_id_16hex}-{flags_2hex}")
 * and return just the trace_id component, or null on failure.
 *
 * Maximum parent header value length per W3C spec is 55 bytes.
 * We extract trace-id (32 hex chars) from the second field.
 */
export function parseTraceparent(header: string): string | undefined {
  // Per W3C spec, traceparent = version(2) + "-" + trace-id(32) + "-" + span-id(16) + "-" + trace-flags(2)
  // version is "00" or "01", but we accept any 2-hex-char version
  const m = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/i.exec(header.trim());
  if (!m) return undefined;
  return m[1].toLowerCase();
}

/** Result of resolving logging context IDs from a request. */
export interface ContextIds {
  /** Unique per-request identifier. */
  req: string;
  /** Stable session/trace identifier shared across related requests. */
  traceId: string;
}

/**
 * Resolve trace_id and req from incoming request headers.
 * Used once per request in index.ts before handler dispatch.
 */
export function resolveContextIds(request: Request): ContextIds {
  // --- trace_id resolution ---
  let traceId: string | undefined;

  // 1. W3C traceparent header — most standards-compliant
  const tp = request.headers.get('traceparent');
  if (tp) {
    traceId = parseTraceparent(tp);
  }

  // 2. X-Trace-Id header
  if (!traceId) {
    const xt = request.headers.get('X-Trace-Id');
    if (xt) traceId = xt.trim().slice(0, 64);
  }

  // 3. X-Request-Id header (reused as trace_id for retry correlation)
  if (!traceId) {
    const xri = request.headers.get('X-Request-Id');
    if (xri) traceId = xri.trim().slice(0, 64);
  }

  // 4. Auto-generated fallback
  if (!traceId) traceId = generateId();

  // --- req resolution ---
  const clientReqId = request.headers.get('X-Request-Id');
  const req = clientReqId ? clientReqId.trim().slice(0, 64) : generateId();

  return { req, traceId };
}

/**
 * Wrap an async operation with trace_id and req in the logging context.
 * Nests safely — previous values are restored in the `finally` block.
 */
export async function withContextIds<T>(ids: ContextIds, fn: () => Promise<T>): Promise<T> {
  const prevReq = currentRequestId;
  const prevTrace = currentTraceId;
  currentRequestId = ids.req;
  currentTraceId = ids.traceId;
  try {
    return await fn();
  } finally {
    currentRequestId = prevReq;
    currentTraceId = prevTrace;
  }
}

/** Get the current request ID (for passing to sub-systems or embedding in responses). */
export function getRequestId(): string | undefined {
  return currentRequestId;
}

/** Get the current trace/session ID. */
export function getTraceId(): string | undefined {
  return currentTraceId;
}
