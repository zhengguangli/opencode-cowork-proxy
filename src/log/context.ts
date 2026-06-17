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
 * Generate a short unique request ID (8 chars).
 * Uses crypto.randomUUID() when available for better uniqueness,
 * falls back to Math.random() + Date.now().
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
