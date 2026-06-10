/**
 * Stream backpressure helper for ReadableStream translations.
 *
 * WHEN TO READ THIS FILE: Debugging stream buffer issues, changing backpressure
 * strategy, tuning CF Workers memory usage under high throughput.
 *
 * When the consumer is behind (desiredSize ≤ 0), yields control with an
 * adaptive microtask delay proportional to how far negative desiredSize is.
 * Prevents unbounded buffering in CF Workers memory-constrained environment.
 */

export async function applyBackpressure(
  controller: ReadableStreamDefaultController,
): Promise<void> {
  if (controller.desiredSize !== null && controller.desiredSize <= 0) {
    // Adaptive delay: longer backpressure for deeper buffer buildup
    // Max 100ms to avoid blocking the stream while still allowing drain
    const waitMs = Math.min(Math.abs(controller.desiredSize) * 0.5, 100);
    if (waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
}
