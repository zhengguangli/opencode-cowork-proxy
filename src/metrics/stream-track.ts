/**
 * Active-stream tracking wrapper for ReadableStream.
 *
 * Wraps a ReadableStream to increment a counter when the stream is first
 * read (active stream started) and decrement when it ends (done/cancel/error).
 *
 * USAGE:
 *   const tracked = trackActiveStream(originalStream, metricsRegistry);
 *   return new Response(tracked, ...);
 *
 * WHEN TO READ THIS FILE: Modifying active stream tracking behavior.
 */

import type { MetricsRegistry } from './registry';

/**
 * Wrap a ReadableStream to track active connections via the provided registry.
 *
 * Pattern: new active stream → increment; stream done/cancelled → decrement.
 * Uses a guard flag to ensure decrement happens exactly once.
 */
export function trackActiveStream(stream: ReadableStream, registry: MetricsRegistry): ReadableStream {
  registry.incrementActiveStreams();
  let closed = false;

  const reader = stream.getReader();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (!closed) {
            closed = true;
            registry.decrementActiveStreams();
          }
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (err) {
        if (!closed) {
          closed = true;
          registry.decrementActiveStreams();
        }
        controller.error(err);
      }
    },
    cancel(reason) {
      if (!closed) {
        closed = true;
        registry.decrementActiveStreams();
      }
      reader.cancel(reason);
    },
  });
}
