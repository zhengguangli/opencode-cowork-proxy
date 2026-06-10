/**
 * Tests for the stream backpressure helper.
 *
 * Covers:
 *   - applyBackpressure() behavior with various desiredSize values
 *   - No-op when desiredSize is null
 *   - No-op when desiredSize is positive
 *   - Adaptive delay when desiredSize is negative
 *
 * Note: In a test environment (non-CF-Worker), the ReadableStreamDefaultController
 * is mocked to simulate different backpressure states.
 */
import { describe, it, expect } from 'vitest';
import { applyBackpressure } from '../src/backpressure';

/** Create a mock controller with a given desiredSize. */
function mockController(desiredSize: number | null): ReadableStreamDefaultController {
  // The controller interface is minimal for our use case
  return { desiredSize } as unknown as ReadableStreamDefaultController;
}

describe('applyBackpressure', () => {
  it('resolves immediately when desiredSize is null (no backpressure info)', async () => {
    const controller = mockController(null);
    const start = Date.now();
    await applyBackpressure(controller);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50); // should resolve instantly
  });

  it('resolves immediately when desiredSize is positive (consumer keeping up)', async () => {
    const controller = mockController(10);
    const start = Date.now();
    await applyBackpressure(controller);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it('resolves immediately when desiredSize is zero (at capacity but not backlogged)', async () => {
    const controller = mockController(0);
    const start = Date.now();
    await applyBackpressure(controller);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it('applies small delay when desiredSize is mildly negative', async () => {
    const controller = mockController(-10);
    const start = Date.now();
    await applyBackpressure(controller);
    // Adaptive delay = Math.min(|-10| * 0.5, 100) = 5ms
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(4);
    expect(elapsed).toBeLessThan(50);
  });

  it('applies larger delay when desiredSize is very negative', async () => {
    const controller = mockController(-200);
    const start = Date.now();
    await applyBackpressure(controller);
    // Adaptive delay = Math.min(|-200| * 0.5, 100) = 100ms
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(200);
  });

  it('caps delay at 100ms even for extremely negative desiredSize', async () => {
    const controller = mockController(-10000);
    const start = Date.now();
    await applyBackpressure(controller);
    // Adaptive delay = Math.min(|-10000| * 0.5, 100) = 100ms
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(200);
  });

  it('resolves quickly when desiredSize is -1 (minimal backpressure)', async () => {
    const controller = mockController(-1);
    const start = Date.now();
    await applyBackpressure(controller);
    // Adaptive delay = Math.min(|-1| * 0.5, 100) = 0.5ms → resolves via microtask
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(20);
  });
});
