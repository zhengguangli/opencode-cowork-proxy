---
name: stream-debug
description: "Debugging guide for SSE streaming issues in all 3 translation directions: Anthropic→OpenAI, OpenAI→Anthropic, Chat Completions→Responses API. MUST use for: streaming hangs, truncated responses, malformed events, out-of-order events, missing [DONE] terminator, missing message_stop, content_block_start without matching content_block_stop, double events on block type switches, inline <think> tags appearing in client output, mid-stream errors that don't propagate, abort/timeout signal issues. Covers event format differences, common test patterns using mock ReadableStream, and known pitfalls."
---

# Streaming Debug Guide

Streaming bugs are the most expensive class in the proxy — they fail silently, hang clients, and reproduce only under load. This guide covers how to diagnose and fix them.

## SSE Format Differences (Quick Reference)

| Format | Event line | Data line | Terminator |
|--------|-----------|-----------|------------|
| **Anthropic** | `event: <type>\n` | `data: <json>\n` | Empty `\n` after each event |
| **OpenAI Chat Completions** | (no event line) | `data: <json>\n` | `data: [DONE]\n\n` |
| **OpenAI Responses API** | (no event line) | `data: <json>\n` | `data: [DONE]\n\n` |

All formats separate events with `\n\n`.

## Anthropic Event Vocabulary

| Event | Purpose | Required fields |
|-------|---------|----------------|
| `message_start` | Stream begin; carries initial `message` object | `message.id`, `message.role`, `message.model` |
| `content_block_start` | Open a content block (text, thinking, tool_use, image) | `index`, `content_block.{type,...}` |
| `content_block_delta` | Append to current block | `index`, `delta` |
| `content_block_stop` | Close current block | `index` |
| `message_delta` | Update message-level fields (stop_reason, usage) | `delta.stop_reason`, `usage` |
| `message_stop` | Stream end | (empty) |
| `ping` | Keep-alive | (empty) |
| `error` | Mid-stream error | `error.{type,message}` |

## OpenAI Chat Completions Event Vocabulary

Each chunk is a choice with a delta:
```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion.chunk",
  "choices": [{
    "index": 0,
    "delta": {"role": "assistant", "content": "..."},
    "finish_reason": null
  }]
}
```

The final chunk has `finish_reason: "stop" | "tool_calls" | "length" | "content_filter"`. Stream terminates with `data: [DONE]\n\n`.

## OpenAI Responses API Event Vocabulary

Different from Chat Completions:
- `response.created` — stream begin
- `response.output_item.added` — open an output item (message, function_call, reasoning)
- `response.text.delta` — text content delta
- `response.reasoning_text.delta` — reasoning delta
- `response.function_call_arguments.delta` — tool call arguments delta
- `response.output_item.done` — close an output item
- `response.completed` — stream end

Stream terminates with `data: [DONE]\n\n`.

---

## The Block Lifecycle Invariant (CRITICAL)

In Anthropic-style streams, every `content_block_start` MUST be followed by ≥1 `content_block_delta` and exactly one `content_block_stop`. The most common streaming bug is violating this.

```
content_block_start (type:text)         ← open text block
content_block_delta (text:"Hello ")     ← append
content_block_delta (text:"world")      ← append
content_block_stop (index:0)            ← close text block  ← MUST come before next start

content_block_start (type:tool_use)     ← open tool_use block
content_block_delta (input_json_delta)  ← append partial JSON
content_block_stop (index:1)            ← close tool_use block
```

**Switching block types** (text → thinking → tool_use) requires `content_block_stop` for the old type before `content_block_start` for the new type. Forgetting this is the #1 streaming bug.

---

## Common Streaming Bugs and Their Fixes

### Symptom: Client hangs forever

**Root cause:** Missing terminator. Either `message_stop` (Anthropic) or `data: [DONE]` (OpenAI) was never emitted.

**Fix:** Ensure the chunk-processing loop always emits the terminator on the last chunk, even if the upstream connection was closed early.

### Symptom: Truncated response (last few tokens missing)

**Root cause:** `controller.enqueue` not called for the last chunk, OR the upstream body was consumed but not fully drained.

**Fix:** Use a `for await` loop on the upstream body and ensure each chunk is forwarded. Don't break out of the loop on the first null chunk.

### Symptom: Extra/double events

**Root cause:** `content_block_start` emitted without checking the current block state. If a previous block is still open, the new `content_block_start` creates an inconsistent state.

**Fix:** Track `currentBlockType` and `currentBlockIndex` in the translator state. Before emitting `content_block_start`, check if a block is open and emit `content_block_stop` first.

### Symptom: Malformed JSON in tool call arguments

**Root cause:** Cross-chunk argument accumulation logic not joining strings. OpenAI sends tool call arguments incrementally (`{"a":` then `1}`); the translator must concatenate them and parse only at `content_block_stop`.

**Fix:** Buffer arguments by `tool_call_index`. Concatenate `delta.function.arguments` strings. Parse the full JSON only when the tool call finishes.

### Symptom: `<think>` tags appear in client output (Minimax quirk)

**Root cause:** The translator doesn't strip inline `<think>...</think>` tags. Some models (Minimax) embed reasoning inside `<think>` tags within the `content` field rather than using the standard `reasoning_content` field.

**Fix:** Use a state machine. Track `inThinkTag` boolean and `thinkTagBuffer` string. When a chunk contains `<` followed by `think`, enter the tag. When `</think>` is seen, exit. **Critically: handle tags split across chunks.** If chunk 1 ends with `<th` and chunk 2 starts with `ink>`, the state machine must buffer and reassemble.

```typescript
// State machine pattern (see src/translate/stream/chat-completions-to-responses.ts)
let inThinkTag = false;
let thinkTagBuffer = "";

function processChunk(text: string): string {
  let out = "";
  for (const ch of text) {
    thinkTagBuffer += ch;
    if (thinkTagBuffer.endsWith("<think>")) {
      inThinkTag = true;
      thinkTagBuffer = "";
    } else if (thinkTagBuffer.endsWith("</think>")) {
      inThinkTag = false;
      thinkTagBuffer = "";
    } else if (!inThinkTag && !["<", "t", "h", "i", "n", "k"].some(p => thinkTagBuffer.endsWith(p))) {
      // Buffer is past the longest possible tag prefix; flush it
      out += thinkTagBuffer;
      thinkTagBuffer = "";
    }
  }
  // Flush remaining buffer at end of stream (don't drop silently)
  if (!inThinkTag) out += thinkTagBuffer;
  thinkTagBuffer = "";
  return out;
}
```

### Symptom: Token counts wrong (charged for tokens you didn't use)

**Root cause:** `message_delta` with usage not emitted at stream end, OR usage emitted twice (once from a chunk that contained it, once from the synthetic final chunk).

**Fix:** Emit `message_delta` with usage exactly once at the end. If the upstream's final chunk already includes usage, don't add a synthetic one.

### Symptom: Connection resets after 60 seconds

**Root cause:** `createStreamSignal` not used. The translator uses `AbortSignal.timeout(60_000)` which is fine for non-streaming but kills streams at 60s. Streams should have a 120s timeout and abort on client disconnect.

**Fix:** Use `createStreamSignal(request)` (defined in `src/index.ts`) which:
- Sets a 120s timeout
- Also listens to `request.signal` and aborts immediately on client disconnect

```typescript
// CORRECT
const upstreamSignal = openaiReq.stream ? createStreamSignal(request) : AbortSignal.timeout(60_000);

// WRONG — kills long streams at 60s
const upstreamSignal = AbortSignal.timeout(60_000);
```

### Symptom: Upstream rate-limit headers lost on streaming responses

**Root cause:** `forwardUpstreamHeaders()` not called on the stream response.

**Fix:** Add `forwardUpstreamHeaders(streamHeaders, upstreamRes);` before returning the streaming Response.

---

## Testing Streaming Code (Mock ReadableStream Pattern)

The proxy tests don't call the real upstream. They construct a mock `ReadableStream` from an array of SSE-encoded chunks and assert on the decoded output.

```typescript
function makeMockStream(chunks: string[]): ReadableStream {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

it("emits content_block_start → delta → stop on OpenAI text chunk", async () => {
  const upstream = makeMockStream([
    'data: {"choices":[{"delta":{"role":"assistant","content":"Hi"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":" there"},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ]);
  
  const out = collectStream(streamOpenAIToAnthropic(upstream, "test-model"));
  expect(out).toContain("event: message_start");
  expect(out).toContain("event: content_block_start");
  expect(out).toContain("event: content_block_delta");
  expect(out).toContain("event: content_block_stop");
  expect(out).toContain("event: message_stop");
});
```

For <think> cross-chunk testing, split the tag across chunks:
```typescript
it("strips <think> tags split across chunks", async () => {
  const upstream = makeMockStream([
    'data: {"choices":[{"delta":{"content":"<th"}}]}\n\n',      // chunk ends mid-tag
    'data: {"choices":[{"delta":{"content":"ink>hidden</think>visible"}}]}\n\n',
  ]);
  const out = collectStream(streamChatCompletionsToResponses(upstream, "test"));
  expect(out).not.toContain("<think>");
  expect(out).not.toContain("hidden");
  expect(out).toContain("visible");
});
```

---

## Abort Signal Wiring (Reference)

The proxy must abort the upstream `fetch` if:
1. The client disconnects (request.signal triggers) — abort immediately
2. The upstream stalls for >120s — abort as a safety net

`createStreamSignal()` in `src/index.ts` handles both:
```typescript
function createStreamSignal(request: Request): AbortSignal {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000);
  request.signal.addEventListener('abort', () => {
    clearTimeout(timeoutId);
    controller.abort();
  }, { once: true });
  return controller.signal;
}
```

The chunk-processing loop must handle `AbortError` from `await reader.read()` cleanly — break out of the loop, don't throw an unhandled rejection.

---

## Debugging Checklist (Run Through This First)

1. **What format are the chunks in?** Anthropic has `event:` lines, OpenAI doesn't.
2. **Is the stream terminating?** Look for `message_stop` (Anthropic) or `data: [DONE]` (OpenAI).
3. **Are block lifecycles valid?** Count `content_block_start` vs `content_block_stop` — they must match.
4. **Are block type switches explicit?** Look for `content_block_start` after a `content_block_start` without a `content_block_stop` in between.
5. **Is the state machine initialized?** For `<think>` stripping, the `inThinkTag` state must persist across chunks.
6. **Is the signal wired?** Long streams with `AbortSignal.timeout(60_000)` will die at 60s.
7. **Are headers forwarded?** `forwardUpstreamHeaders()` on the stream Response.
