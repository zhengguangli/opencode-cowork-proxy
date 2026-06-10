/**
 * Shared SSE frame parsing utilities.
 *
 * WHEN TO READ THIS FILE: Changing how SSE data lines are extracted from frames,
 * or adding/removing sentinel handling.
 *
 * This module provides pure (side-effect-free) parsing of SSE frames and buffers.
 * It does NOT handle streaming state — that is managed by the caller's read loop.
 * It does NOT parse JSON — that is the caller's responsibility after it receives
 * the data strings.
 */

/**
 * Extract data payload strings from a single SSE frame (already split by \n\n boundary).
 *
 * Each frame may contain one or more "data: <payload>" lines.
 * Filters out [DONE] sentinels and non-data lines.
 * Returns the raw JSON payload strings after the "data: " prefix.
 */
export function parseSseFrame(frame: string): string[] {
  if (!frame.trim()) return [];
  const results: string[] = [];
  const lines = frame.split("\n");
  for (const line of lines) {
    if (line.trim() && line.startsWith("data: ")) {
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      results.push(data);
    }
  }
  return results;
}

/**
 * Parse remaining buffer at end-of-stream.
 *
 * Unlike parseSseFrame (which expects a single \n\n-delimited frame),
 * this accepts a raw buffer that may contain multiple \n\n-delimited frames
 * (the typical state of the buffer when the stream ends).
 */
export function parseSseBuffer(buffer: string): string[] {
  if (!buffer.trim()) return [];
  const results: string[] = [];
  const frames = buffer.split("\n\n");
  for (const frame of frames) {
    results.push(...parseSseFrame(frame));
  }
  return results;
}
