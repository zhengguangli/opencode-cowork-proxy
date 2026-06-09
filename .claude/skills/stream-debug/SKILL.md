---
name: stream-debug
description: "Debugging guide for SSE streaming issues in all 3 translation directions: Anthropic→OpenAI, OpenAI→Anthropic, Chat Completions→Responses API. MUST use for: streaming hangs, truncated responses, malformed events, out-of-order events, missing [DONE] terminator, missing message_stop, content_block_start without matching content_block_stop, double events on block type switches, inline <think> tags appearing in client output, mid-stream errors that don't propagate, abort/timeout signal issues, rate-limit headers lost on stream response. Covers SSE format differences, event vocabularies for all 3 formats, block lifecycle invariant, common bug diagnosis with root cause + fix, mock ReadableStream testing pattern, cross-chunk <think> tag test pattern, abort signal wiring."
---

# Streaming Debug Guide

Streaming bugs are the most expensive class in the proxy — they fail silently, hang clients, and reproduce only under load.

## SSE Format Differences

| Format | Event line | Data line | Terminator |
|--------|-----------|-----------|------------|
| **Anthropic** | `event: <type>\n` | `data: <json>\n` | Empty `\n` after each event |
| **OpenAI Chat Completions** | (none) | `data: <json>\n` | `data: [DONE]\n\n` |
| **OpenAI Responses API** | (none) | `data: <json>\n` | `data: [DONE]\n\n` |

## Anthropic Event Vocabulary

| Event | Purpose | Required fields |
|-------|---------|----------------|
| `message_start` | Stream begin | `message.id`, `message.role`, `message.model` |
| `content_block_start` | Open content block | `index`, `content_block.{type,...}` |
| `content_block_delta` | Append to block | `index`, `delta.{type,...}` |
| `content_block_stop` | Close block | `index` |
| `message_delta` | Update message | `delta.stop_reason`, `usage` |
| `message_stop` | Stream end | (empty) |
| `error` | Mid-stream error | `error.{type,message}` |

## OpenAI Chat Completions Event Vocabulary

Each chunk is `{choices: [{delta: {role?, content?, tool_calls?}, finish_reason?: "stop"|"tool_calls"|"length"}]}`. Terminates with `data: [DONE]\n\n`.

`reasoning_content` appears as `{choices: [{delta: {reasoning_content: "..."}}]}` — it's a top-level delta field, not inside `content`.

## OpenAI Responses API Event Vocabulary

`response.created` → `response.output_item.added` → `response.text.delta` / `response.reasoning_text.delta` / `response.function_call_arguments.delta` → `response.output_item.done` → `response.completed`. Terminates with `data: [DONE]\n\n`.

---

## The Block Lifecycle Invariant (CRITICAL)

Every `content_block_start` MUST be followed by ≥1 delta and exactly one `content_block_stop`. Block type switches require a stop for the old type before start for the new type:

```
content_block_start (type:text)         ← open
content_block_delta (text:"Hello ")     ← append
content_block_stop (index:0)            ← close (MUST come before next start)
content_block_start (type:tool_use)     ← open new type
content_block_delta (input_json_delta)  ← append
content_block_stop (index:1)            ← close
```

---

## Common Bugs: Diagnosis and Fix

| Symptom | Root cause | Fix |
|---------|-----------|-----|
| Client hangs forever | Missing terminator (`message_stop` or `data: [DONE]`) | Ensure loop always emits terminator on last chunk |
| Truncated response | `controller.enqueue` not called for last chunk; upstream not fully drained | Use `for await` loop, ensure every chunk forwarded |
| Extra/double events | `content_block_start` emitted without checking current block state | Track `currentBlockType`/`currentBlockIndex`. Emit stop before next start. |
| Malformed JSON in tool call arguments | Cross-chunk argument accumulation not joining strings | Buffer arguments by `tool_call_index`, concatenate strings, parse only at stop |
| `<think>` tags in client output (Minimax) | Translator doesn't strip inline tags | Use `inThinkTag` + `thinkTagBuffer` state machine; handle cross-chunk; flush on stream end |
| Token counts wrong | `message_delta` with usage not emitted, or emitted twice | Emit exactly once at stream end |
| Connection resets at 60s | `createStreamSignal` not used — `AbortSignal.timeout(60_000)` kills streams | Use `createStreamSignal(request)` (120s timeout + client disconnect) |
| Rate-limit headers lost | `forwardUpstreamHeaders()` not called on stream response | Call before returning streaming Response |

---

## Cross-Chunk `<think>` Tag Stripping

```typescript
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
    } else if (!inThinkTag && !["<","t","h","i","n","k"].some(p => thinkTagBuffer.endsWith(p))) {
      out += thinkTagBuffer;
      thinkTagBuffer = "";
    }
  }
  if (!inThinkTag) out += thinkTagBuffer;
  thinkTagBuffer = "";
  return out;
}
```

---

## Testing Pattern (Mock ReadableStream)

```typescript
function makeMockStream(chunks: string[]): ReadableStream {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

it("emits correct block lifecycle", async () => {
  const upstream = makeMockStream([
    'data: {"choices":[{"delta":{"role":"assistant","content":"Hi"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":" there"},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ]);
  const out = collectStream(streamOpenAIToAnthropic(upstream, "test-model"));
  expect(out).toContain("event: message_start");
  expect(out).toContain("event: content_block_start");
  expect(out).toContain("event: content_block_stop");
  expect(out).toContain("event: message_stop");
});
```

Cross-chunk `<think>` tag test:
```typescript
it("strips <think> tags split across chunks", async () => {
  const upstream = makeMockStream([
    'data: {"choices":[{"delta":{"content":"<th"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"ink>hidden</think>visible"}}]}\n\n',
  ]);
  const out = collectStream(streamChatCompletionsToResponses(upstream, "test"));
  expect(out).not.toContain("<think>");
  expect(out).toContain("visible");
});
```

---

## Abort Signal Wiring

`createStreamSignal()` in `src/index.ts`: 120s timeout + abort on client disconnect. The chunk loop must handle `AbortError` — break cleanly, no unhandled rejection.

## Debugging Checklist

1. What format are chunks in? (Anthropic has `event:` lines, OpenAI doesn't)
2. Is stream terminating? (`message_stop` or `data: [DONE]`)
3. Are block lifecycles valid? (count start vs stop — must match)
4. Are block type switches explicit? (stop before next start)
5. Is state machine initialized? (`inThinkTag` persists across chunks)
6. Is signal wired? (120s, not 60s)
7. Are headers forwarded? (`forwardUpstreamHeaders()` on stream Response)
