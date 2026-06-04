# Streaming Fixes Summary

> Date: 2026-06-04
> All 138 tests passing (7 test files).

---

## Bug 7 (MEDIUM): Tool call indices use Anthropic content block index instead of 0-based

**File:** `src/translate/stream/anthropic-to-openai.ts`

**Changes:**
- Added `toolCallCounter` — a dedicated 0-based sequential counter for OpenAI tool call indices, independent of `contentBlockIndex`
- Added `toolCallIndex` field to the `toolCallMap` value type
- Changed tool call emission in `content_block_start(tool_use)`: `index: contentBlockIndex` → `index: tcIndex` (from `toolCallCounter++`)
- Changed tool call argument emission in `input_json_delta`: `index: contentBlockIndex` → `index: tc.toolCallIndex`

**Why:** The existing code used `contentBlockIndex` as the OpenAI tool call index. When text blocks precede tool calls, the first tool call starts at index > 0, violating the OpenAI convention where tool call indices start at 0 and increase sequentially. Some client implementations may fail with non-standard index values.

---

## Bug 9 (LOW): [DONE] marker sent unconditionally even after stream errors

**File:** `src/translate/stream/anthropic-to-openai.ts`

**Changes:**
- Replaced `try { ... } finally { reader.releaseLock(); }` with `try { ... } catch { controller.close(); reader.releaseLock(); return; }`
- Separated `reader.releaseLock()` into its own call after the try-catch block
- On stream error: closes the controller without emitting `data: [DONE]`, masking the abnormal termination signal

**Why:** The previous code wrapped the read loop in `try { ... } finally { reader.releaseLock(); }` which did NOT catch errors. If the upstream stream threw (network error, premature close), the `finally` block released the reader and execution continued to line 185 where `[DONE]` was emitted — the client received a clean termination signal despite a truncated/erroneous payload.

---

## Bug 1 (CRITICAL): SSE line splitting causes data loss on TCP fragmentation

**File:** `src/translate/stream/openai-to-anthropic.ts`

**Changes:**
- Main loop (lines 259-280): replaced `buffer.split('\n')` with `buffer.split('\n\n')`, storing incomplete frames in buffer
- End-of-stream handler (lines 238-255): same replacement
- Wrapped frame processing in an inner `for (const line of frame.split('\n'))` loop

**Why:** Splitting on single `\n` loses data when a TCP packet boundary splits a `data:` line mid-content. The fragment is parsed independently and silently discarded. Splitting on `\n\n` (SSE frame boundary) preserves partial lines across TCP chunks, matching the correct implementation already present in `anthropic-to-openai.ts`.

---

## Bug 5 (HIGH): Parallel tool call arguments in same chunk cross-contaminate

**File:** `src/translate/stream/openai-to-anthropic.ts`

**Changes:**
- Replaced single `currentToolCallId: string | null` with per-index tracking:
  - `activeToolCallId` — current tool call for type-switch detection
  - `toolCallIdByOaiIndex: Map<number, string>` — maps OpenAI `tool_call.index` to tool call ID
  - `oaiIndexToCbIndex: Map<number, number>` — maps OpenAI tool_call index to content block index
- Rewrote tool call handler:
  - Uses `!!toolCall.id` (isNewDeclaration) as the signal for new tool calls, not comparison to `currentToolCallId`
  - Argument accumulation looks up tool call ID by `toolCall.index` via `toolCallIdByOaiIndex`
  - Content block index for deltas looked up from `oaiIndexToCbIndex`
- Updated `activeToolCallId = null` in reasoning/text flush blocks (was `currentToolCallId = null`)

**Why:** When two tool calls start in the same chunk, `currentToolCallId` was overwritten to the second one. Subsequent argument-only chunks for the first tool call (index 0) accumulated to the second tool call (via `currentToolCallId`). The per-index Map lookup ensures arguments always go to the correct tool call, regardless of processing order.

---

## Bug 6 (MEDIUM): Empty content string creates spurious empty text block before reasoning

**File:** `src/translate/stream/openai-to-anthropic.ts`

**Changes:**
- Wrapped the text handler body inside `if (delta.content === "" && !hasStartedTextBlock) { /* skip */ } else { /* existing logic */ }`
- Changed unconditional `text_delta` emission to `if (delta.content) { enqueueSSE(...) }`

**Why:** When a priming chunk contains both `reasoning_content: "..."` and `content: ""`, the empty content handler would create a text block before the reasoning block, then immediately close it when reasoning starts. The result was a spurious empty text block at position 0. The fix skips creating a text block for empty priming content.

---

## Bug 2 (CRITICAL): Missing `message_start` when stream has empty/null delta with finish_reason

**File:** `src/translate/stream/openai-to-anthropic.ts`

**Changes:**
- Added synthetic `message_start` emission at stream end (before `message_delta`) when `messageStarted` is still `false`
- The synthetic message has `content: []`, `stop_reason: null`, and zeroed usage

**Why:** If the OpenAI stream's first (and only) meaningful chunk has an empty delta with `finish_reason` (e.g., response filtered, empty stop response), no content block is ever started and `message_start` is never emitted. The resulting Anthropic SSE stream would jump straight to `message_delta`/`message_stop` without a preceding `message_start`, violating the Anthropic streaming protocol which requires `message_start` as the first event.

---

## Bug 3 (HIGH): Tool call arguments dropped when sent in same chunk as tool call ID

**File:** `src/translate/stream/chat-completions-to-responses.ts`

**Changes:**
- Changed `if (tc.id) { ... } else if (tc.function?.arguments) { ... }` to two independent `if` statements
- Added comment documenting that arguments are processed regardless of `id` presence

**Why:** Several OpenAI-compatible providers send tool call ID, name, AND initial arguments in the same streaming chunk. The original `if/else if` chain skipped the arguments branch when `id` was present, silently dropping the initial arguments. The fix processes both id/name and arguments independently.

---

## Bug 4 (HIGH): Empty content string in same chunk as `reasoning_content` triggers premature reasoning flush

**File:** `src/translate/stream/chat-completions-to-responses.ts`

**Changes:**
- Changed `if (activeItemType && activeItemType !== "text") { flushActiveItem(); }` to:
  ```
  if (activeItemType === "reasoning" && delta.content === "") {
    // Skip — don't flush reasoning for empty priming content
  } else if (activeItemType && activeItemType !== "text") {
    flushActiveItem();
  }
  ```

**Why:** Many reasoning models (DeepSeek, Qwen) send a priming chunk with both `reasoning_content: "..."` AND `content: ""`. The text handler would fire, see `activeItemType === "reasoning"` (not "text"), and call `flushActiveItem()` — prematurely finalizing the reasoning item. The next reasoning chunk would create a second (incorrect) reasoning item. The fix skips the flush when reasoning is active and the content is empty.

---

## Bug 8 (MEDIUM): Stream ending with only empty content and stop reason produces empty output array

**File:** `src/translate/stream/chat-completions-to-responses.ts`

**Changes:**
- Added synthetic output item creation at stream end (after flush, before terminal event):
  - Checks `outputItems.length === 0 && finishReason`
  - Creates an empty text output item with `content: [{ type: "output_text", text: "" }]`

**Test update:**
- `test/responses.test.ts`: Updated "handles stream with no content (empty response)" test to expect `"type":"output_text"` instead of `"output":[]`

**Why:** When the only non-null delta content is an empty string with a finish_reason, the stream generates zero output items. The final response has `output: []`, which means the response appears to have no content. The fix creates a synthetic empty text item to ensure at least one output exists.
