/**
 * Request ID context management for structured logging.
 *
 * Cloudflare Workers do not support AsyncLocalStorage. Each isolate processes
 * one request at a time, so a mutable module-level variable is safe and portable.
 *
 * WHEN TO READ THIS FILE: Modifying request ID generation or context propagation.
 *
 * Exports:
 *   generateId()        — Generate a short unique request ID
 *   withRequestId()     — Wrap an async operation with request ID context
 *   getRequestId()      — Get the current request ID (or undefined)
 *   currentRequestId    — Module-level variable (mutable, CF Workers compatible)
 */

/** Per-request ID — populated by withRequestId(), read by logger.ts write(). */
export let currentRequestId: string | undefined;

/**
 * Generate a short unique request ID (10-12 chars, hex-like).
 * Used for log correlation across a single request's lifecycle.
 */
export function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/**
 * Wrap an async operation with a request_id in the logging context.
 * Nests safely — the previous ID is restored in the `finally` block.
 */
export async function withRequestId<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = currentRequestId;
  currentRequestId = id;
  try {
    return await fn();
  } finally {
    currentRequestId = prev;
  }
}

/** Get the current request ID (for passing to sub-systems or embedding in responses). */
export function getRequestId(): string | undefined {
  return currentRequestId;
}
