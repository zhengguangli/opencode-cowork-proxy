/**
 * Think tag stripping utilities for response translation.
 *
 * Non-streaming: use the standalone stripThinkTags() function (simple regex).
 * Streaming: use the ThinkTagStripper class (stateful — handles tags split across chunks).
 *
 * See docs/FIXES.md §Fix 1 for the minimax-m3-free background.
 */

/**
 * Strip <think>...</think> blocks from a complete text string (non-streaming).
 * Uses regex for simplicity since the entire text is available at once.
 */
export function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/**
 * Stateful think tag stripper for streaming use, where <think>/</think> tags
 * may be split across SSE chunks.
 *
 * Usage:
 *   const stripper = new ThinkTagStripper();
 *   // For each chunk:
 *   const cleaned = stripper.strip(chunkText);
 *   if (cleaned !== null) emitTextDelta(cleaned);
 */
export class ThinkTagStripper {
  private buffer = "";
  private inTag = false;

  /**
   * Process a chunk of text and return cleaned output.
   * Returns null if the chunk was entirely consumed by a closing think tag
   * (nothing to emit as text).
   */
  strip(raw: string): string | null {
    if (!raw) return raw;

    let result = "";
    let remaining = raw;

    while (remaining.length > 0) {
      if (this.inTag) {
        const closeIdx = remaining.indexOf('</think>');
        if (closeIdx !== -1) {
          this.buffer += remaining.slice(0, closeIdx);
          this.inTag = false;
          remaining = remaining.slice(closeIdx + 8); // 8 = len('</think>')
          this.buffer = "";
        } else {
          this.buffer += remaining;
          remaining = "";
        }
      } else {
        const openIdx = remaining.indexOf('<think>');
        if (openIdx !== -1) {
          result += remaining.slice(0, openIdx);
          this.buffer = remaining.slice(openIdx + 7); // 7 = len('<think>')
          this.inTag = true;
          // Check if this chunk also contains the closing tag
          const closeIdx = this.buffer.indexOf('</think>');
          if (closeIdx !== -1) {
            remaining = this.buffer.slice(closeIdx + 8);
            this.inTag = false;
            this.buffer = "";
            continue;
          }
          remaining = "";
        } else {
          result += remaining;
          remaining = "";
        }
      }
    }

    return result || null;
  }
}
