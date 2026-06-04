---
name: stream-debug
description: "Debugging guide for SSE streaming issues in both translation directions. Use when diagnosing streaming hangs, truncated responses, malformed events, or event sequencing bugs. Covers common patterns, test approaches, and known pitfalls for Anthropic→OpenAI and OpenAI→Anthropic stream translation."
---

# Streaming Debugging Guide

Guide for diagnosing and fixing SSE streaming issues in the proxy. Streaming bugs are the most common and hardest-to-debug issues — they manifest as hangs, truncated responses, or malformed event sequences.

## Diagnostic Approach

### Step 1: Identify the Direction

Streaming bugs behave differently depending on the direction:

| Direction | Typical Symptom | Likely Root Cause |
|-----------|----------------|-------------------|
| Anthropic→OpenAI | Client receives partial response, hangs before completion | Missing `[DONE]`, missing `content_block_stop` |
| Anthropic→OpenAI | Tool calls don't appear in stream | Tool use deltas not mapped to OpenAI tool_calls format |
| OpenAI→Anthropic | Response never starts (stream opens, no events) | Missing `message_start` event |
| OpenAI→Anthropic | Mid-stream hang, response cuts off | Missing `content_block_stop` before switching block types |
| OpenAI→Anthropic | Usage missing at end | Usage not included in `message_delta` |
| Both directions | Events arrive but client can't parse them | Wrong SSE format (Anthropic uses `event:` lines, OpenAI doesn't) |

### Step 2: Capture the Raw Stream

The most important diagnostic step is to see the raw SSE events. Use:

```bash
# For Anthropic-style streams (event: + data: lines)
curl -N $URL -H "Content-Type: application/json" -d '...' | head -100

# For OpenAI-style streams (data: lines only)
curl -N $URL -H "Content-Type: application/json" -d '...' | grep '^data:'
```

Save the first 50-100 lines of the stream to `_workspace/` for analysis.

### Step 3: Check the Event Sequence

**Anthropic-style stream (correct order):**
```
event: message_start
data: {"type":"message_start","message":{"id":"msg_...","content":[],"usage":{"input_tokens":...}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text","text":"Hello..."}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":...}}

event: message_stop
data: {"type":"message_stop"}
```

**OpenAI-style stream (correct order):**
```
data: {"id":"...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"...","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"...","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":...,"completion_tokens":...}}

data: [DONE]
```

### Step 4: Check Block Transitions

When the stream switches between content types (text → thinking → tool_use), the key rule is:

**Anthropic-style:** You MUST emit `content_block_stop` for the old block before `content_block_start` for the new block.

**OpenAI-style:** OpenAI doesn't have explicit block boundaries. When the delta switches from `content` to `reasoning_content` to `tool_calls`, the Anthropic→OpenAI translator must:
1. Detect the switch
2. Emit `content_block_stop` for the current block
3. Emit `content_block_start` for the new block 

**Common bug:** Two `content_block_start` events in a row without an intervening `content_block_stop`.

## Stream Translation Reference

### Anthropic → OpenAI (streamAnthropicToOpenAI)

Input: Anthropic SSE stream (ReadableStream)
Output: OpenAI SSE stream (ReadableStream)

Transform logic:
1. `message_start` → First `data: {choices:[{delta:{role:"assistant"}}]}`
2. `content_block_start` (text) → `data: {choices:[{delta:{content:""}}]}`
3. `content_block_delta` (text) → `data: {choices:[{delta:{content:"..."}}]}`
4. `content_block_delta` (thinking) → `data: {choices:[{delta:{reasoning_content:"..."}}]}`
5. `content_block_start` (tool_use) → `data: {choices:[{delta:{tool_calls:[{index,id,type:"function",function:{name,arguments:""}}]}}]}`
6. `content_block_delta` (tool_use) → `data: {choices:[{delta:{tool_calls:[{index,function:{arguments:"..."}}]}}]}`
7. `message_delta` → `data: {choices:[{delta:{},finish_reason}],usage:{...}}` + subsequent `data: [DONE]`
8. All other events → skipped (not mapped to OpenAI format)

### OpenAI → Anthropic (streamOpenAIToAnthropic)

Input: OpenAI SSE stream (ReadableStream)
Output: Anthropic SSE stream (ReadableStream)

Transform logic:
1. First chunk with `role:"assistant"` → `event: message_start` + `event: content_block_start` (text or thinking or tool_use depending on which field appears first)
2. Text delta → `event: content_block_delta` with `delta:{type:"text",text}`
3. Reasoning delta → `event: content_block_delta` with `delta:{type:"thinking",thinking}`
4. Tool call delta → `event: content_block_delta` with `delta:{type:"input_json_delta",partial_json}`
5. Type switch detection → Before emitting start for new type, emit `stop` for current type
6. Finish chunk → `event: message_delta` with finish_reason mapped to Anthropic format + usage
7. `[DONE]` → `event: message_stop`

## Tool Calls in Streaming

**OpenAI format:** Tool calls arrive incrementally through `tool_calls` array in the delta. Each tool call has an `index` field. The first chunk contains `id`, `type`, and `function.name`; subsequent chunks add `function.arguments` incrementally.

**Anthropic format:** Tool use blocks are complete blocks. In streaming, the first `content_block_start` has the full `name` and `id`, and `input` starts as `{}`. Then `content_block_delta` events with `type:"input_json_delta"` provide the partial JSON. Finally `content_block_stop` closes the block.

**Translation key points:**
- OpenAI's tool_calls `index` maps to Anthropic's `content_block index`
- The first chunk with a new `index` triggers `content_block_start`
- Subsequent chunks with the same `index` trigger `content_block_delta` (`input_json_delta`)
- When all tool calls are done, `content_block_stop` is emitted for each
- **Bug:** If the model sends text then tool calls, the text block needs a `content_block_stop` before the first `content_block_start` for tool_use

## Testing Streams

```typescript
// Testing approach for stream translators
import { describe, it, expect } from 'vitest';

// Create a mock ReadableStream from an array of SSE strings
function mockStream(chunks: string[]): ReadableStream {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

// Collect stream output
async function collectStream(stream: ReadableStream): Promise<string[]> {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  const events: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    events.push(value);
  }
  return events;
}
```

**What to test:**
1. Single text block stream (simplest case)
2. Multi-block text stream (multiple delta events)
3. Thinking + text stream
4. Tool calls in stream
5. Text then tool calls (type switch)
6. Empty response stream
7. Stream with usage in final chunk
8. Stream that ends abruptly (error handling)

## Known Pitfalls

1. **`content_block_stop` omission before type switch** — Most common streaming bug. Always check: when switching from text to tool_use (or vice versa), is there a `content_block_stop` for the text block before `content_block_start` for the tool_use block?

2. **OpenAI `[DONE]`** — Some OpenAI-compatible upstreams don't send `[DONE]`. The translator accounts for this by detecting `finish_reason` as the termination signal.

3. **OpenAI extra `data: [DONE]`** — Some upstreams send `[DONE]` in addition to the finish chunk. The anthropic→openai translator should NOT double-emit.

4. **Usage in streaming** — OpenAI sends usage in the final chunk (with `finish_reason`). Anthropic sends usage in `message_delta`. Mapping is straightforward but easy to miss.

5. **Empty content_block_start** — Anthropic sends `content_block_start` with empty content for text blocks. This should produce one `data:` line with empty delta rather than being skipped entirely.

6. **Tool call argument accumulation** — OpenAI sends tool call arguments incrementally. The Anthropic→OpenAI translator must concatenate arguments across multiple deltas within a single tool call index.

---

## Responses API Streaming (Chat Completions → Responses API)

Source: `src/translate/stream/chat-completions-to-responses.ts`

The Responses API uses a fundamentally different event vocabulary from Chat Completions or Anthropic streams. Each "output item" in the Responses API has a `type` (`message` | `reasoning` | `function_call`) and emits a paired `*.added` / `*.done` event pair with deltas in between.

### Event Type Vocabulary

| Event | When | Data Shape |
|-------|------|------------|
| `response.created` | Once, before any output items | `{type, response: {id, object, created_at, model, status:"in_progress", output:[]}}` |
| `response.output_item.added` | When a new output item starts | `{type, item: {id, type, ...}}` |
| `response.content_part.added` | When a new content part starts (text only) | `{type, part: {type:"output_text",text:""}, index}` |
| `response.text.delta` | For each text delta | `{type, delta, index}` |
| `response.reasoning_text.delta` | For each reasoning delta (DeepSeek) | `{type, delta, index}` |
| `response.function_call_arguments.delta` | For each tool call argument delta | `{type, delta, index}` |
| `response.content_part.done` | When the active text content part ends | `{type, index, part}` |
| `response.reasoning_text.done` | When the active reasoning item ends | `{type, text, index}` |
| `response.function_call_arguments.done` | When the active function call item ends | `{type, arguments, index}` |
| `response.output_item.done` | When any output item ends | `{type, item: {...item, status:"completed"\|"incomplete"}}` |
| `response.completed` | Stream ends with `status:"completed"` | `{type, response: {..., status:"completed", output:[...]}}` |
| `response.incomplete` | Stream ends with `status:"incomplete"` (length / content_filter / insufficient_system_resource) | `{type, response}` |
| `response.failed` | Reserved for error case | `{type, response}` |

### Stream Translation Reference

**Input:** Chat Completions SSE stream (data: lines)
**Output:** Responses API SSE stream (event: + data: lines)

Transform logic:
1. First chunk with `delta.role:"assistant"` or first content delta → emit `response.created` (exactly once)
2. `delta.content` present → start `message` output item if not active, then emit `response.content_part.added` (first time) + `response.text.delta` (per chunk)
3. `delta.reasoning_content` present → start `reasoning` output item, emit `response.reasoning_text.delta` per chunk (DeepSeek-specific)
4. `delta.tool_calls[]` present → for each `tool_call` with an `id`, start `function_call` output item; for each with `function.arguments`, accumulate and emit `response.function_call_arguments.delta`
5. Type switch detection — before emitting the start of a new type, flush the current item via `response.content_part.done` / `response.reasoning_text.done` / `response.function_call_arguments.done` + `response.output_item.done`
6. Finish chunk (with `finish_reason`) → flush any active item, then emit `response.completed` / `response.incomplete` / `response.failed` based on `finish_reason`
7. `data: [DONE]` → stream terminator (just close the connection; the terminal event was already emitted)

### Tool Calls in Responses API Streaming

**Chat Completions format:** Tool calls arrive incrementally via `tool_calls` array in the delta. Each has an `index`. First chunk contains `id`, `type`, and `function.name`; subsequent chunks add `function.arguments` incrementally.

**Responses API format:** Tool calls are **output items** (not content parts). Lifecycle:
- `response.output_item.added` with `item: {id, type:"function_call", call_id, name, arguments:"", status:"in_progress"}`
- One or more `response.function_call_arguments.delta` events
- `response.function_call_arguments.done` with the final arguments string
- `response.output_item.done` with `item: {...item, status:"completed", arguments: <full>}`

**Critical bug pattern:** When a tool call chunk arrives with both `id` and `arguments` in the same delta, the translator must start the item AND accumulate the arguments in the same pass. Some implementations split these into two handlers and drop the arguments from the first chunk.

### Known Pitfalls (Responses API Streaming)

1. **Empty priming chunks create spurious output items** — OpenAI sends a first chunk with `delta.content === ""` to establish the role. The translator must skip these priming chunks when no active item exists, otherwise an empty `message` output item gets created.
2. **Reasoning flush on empty priming text** — When DeepSeek reasoning is active and an empty `delta.content === ""` priming chunk arrives, the translator must NOT flush the reasoning item. Only flush when real content arrives.
3. **Type switch sequence** — When switching from `reasoning` to `text` or `function_call`, emit `response.reasoning_text.done` + `response.output_item.done` BEFORE `response.output_item.added` for the new type. Skipping the `.done` event leaves the previous item in `in_progress` state.
4. **Empty response with finish_reason** — If the upstream sends a `finish_reason` chunk with no content/reasoning/tool_calls, the translator must synthesize an empty `message` output item (`{type:"message", content:[{type:"output_text",text:""}], status:"completed"}`) so the response has at least one output. Otherwise Responses API clients see `output: []` and crash.
5. **Active item type tracking** — The translator tracks `activeItemType: "text" | "reasoning" | "function_call" | null`. When `activeItemType` is set, switching to a different type must call `flushActiveItem()` first.
6. **Backpressure** — The reader loop yields to the event loop when `controller.desiredSize <= 0` so consumers can drain. Skipping this causes memory pressure and dropped chunks.
