---
name: streaming
description: "SSE translation, stream patterns, finish reason mapping, compression. Triggers on: \"streaming\", \"SSE\", \"流式\", \"finish reason\", \"压缩\". Do NOT trigger for general stream discussion."
capabilities:
  - streaming
  - translation
  - compression
---

# Streaming

## Architecture

```
Upstream SSE (OpenAI/Anthropic format)
    ↓
ReadableStream (raw bytes)
    ↓
TransformStream (stream translator)
    ↓
ReadableStream (target format bytes)
    ↓
compressibleStream() → optional gzip
    ↓
Response (text/event-stream or gzip)
```

## Stream Translators

**Directory:** `src/translate/stream/`

| Translator | Source | Target | Handler |
|-----------|--------|--------|---------|
| `anthropic-to-openai.ts` | Anthropic Messages SSE | OpenAI Chat Completions SSE | `handleAnthropicToOpenAI` |
| `openai-to-anthropic.ts` | OpenAI Chat Completions SSE | Anthropic Messages SSE | `handleOpenAIChatCompletions` |
| `chat-completions-to-responses.ts` | OpenAI Chat Completions SSE | OpenAI Responses API SSE | `handleResponsesAPI` |

All follow the pattern: `ReadableStream → new ReadableStream({ start(controller) { ... } })`.

## SSE Parser

**File:** `src/translate/stream/sse-parser.ts`

```typescript
parseSseFrame(frame: string): string[]
parseSseBuffer(buffer: string): string[]
```

- `parseSseFrame` — splits a single `\n\n`-delimited frame into `data: ` payloads
- Filters out `[DONE]` sentinel lines
- `parseSseBuffer` — splits buffer on `\n\n`, then parses each frame

Used by `openai-to-anthropic.ts` and `chat-completions-to-responses.ts`.

## SSE Encoder

**File:** `src/translate/stream/sse-encoder.ts`

```typescript
createSseEncoder(): (controller, eventType, data) => void
```

Formats events as `event: <type>\ndata: <json>\n\n`. Used by `openai-to-anthropic.ts` and `chat-completions-to-responses.ts`.

`anthropic-to-openai.ts` uses inline encoding (`data: <json>\n\n` format without event type).

## Finish Reason Mapping

**File:** `src/translate/stream/finish-reason.ts`

```typescript
mapFinishReason(finishReason: string | null): string
```

| OpenAI `finish_reason` | Anthropic `stop_reason` |
|------------------------|------------------------|
| `stop` | `end_turn` |
| `tool_calls` | `tool_use` |
| `length` | `max_tokens` |
| `content_filter` | `max_tokens` |
| `insufficient_system_resource` | `max_tokens` |
| (default) | `end_turn` |

Inverse mapping (Anthropic → OpenAI) is inline in `anthropic-to-openai.ts`:
- `tool_use` → `tool_calls`
- `max_tokens` → `length`
- other → `stop`

## Stream Lifecycle

Both `openai-to-anthropic.ts` and `anthropic-to-openai.ts` follow this pattern:

1. Get reader from upstream `ReadableStream`
2. Read chunks in a loop with `TextDecoder`
3. Buffer incomplete frames, split on `\n\n`
4. Parse SSE events, translate to target format
5. Call `applyBackpressure(controller)` after each chunk
6. On stream end, process remaining buffer, emit final events, close controller
7. On error, emit terminal event with `max_tokens` stop reason, close gracefully

## Backpressure

**File:** `src/backpressure.ts`

```typescript
applyBackpressure(controller: ReadableStreamDefaultController): Promise<void>
```

- Checks `controller.desiredSize`
- If `desiredSize ≤ 0`, delays `min(abs(desiredSize) * 0.5ms, 100ms)` to let consumer drain
- Prevents unbounded memory growth in CF Workers

## Compression

**File:** `src/compress.ts`

```typescript
compressibleStream(stream, request): { stream, contentEncoding }
isCompressionAccepted(request): boolean
```

- Checks `Accept-Encoding: gzip`
- Wraps stream with `CompressionStream('gzip')` if client supports it
- Returns `contentEncoding: 'gzip' | null` for response header
- Also used for non-streaming responses in `src/request.ts` `jsonResponse()` (gzip threshold: 1024 bytes)

## Stream Timeout

**File:** `src/config.ts`

```
STREAM_TIMEOUT = 120_000  (120 seconds)
```

Set in `createStreamSignal()` (`src/request.ts`):
- Combines `STREAM_TIMEOUT` with client disconnect signal
- Either timeout or client abort triggers `AbortController`

## Anthropic → OpenAI Stream Details

**File:** `src/translate/stream/anthropic-to-openai.ts`

Event mapping:

| Anthropic Event | OpenAI Output |
|-----------------|---------------|
| `message_start` | Capture `input_tokens`, cache stats |
| `content_block_start` (text) | Emit `delta.content` |
| `content_block_start` (thinking) | Emit `delta.reasoning_content` |
| `content_block_start` (tool_use) | Emit `delta.tool_calls[]` with id/name |
| `content_block_delta` (text_delta) | Emit `delta.content` |
| `content_block_delta` (thinking_delta) | Emit `delta.reasoning_content` |
| `content_block_delta` (input_json_delta) | Emit `delta.tool_calls[].function.arguments` |
| `message_delta` (stop_reason) | Emit finish_reason + usage |
| `message_stop` | End stream |

Tracks tool calls via `toolCallMap` keyed by `contentBlockIndex`.

## OpenAI → Anthropic Stream Details

**File:** `src/translate/stream/openai-to-anthropic.ts`

Content block lifecycle:
1. `message_start` — emitted on first content
2. `content_block_start` — new text/thinking/tool_use block
3. `content_block_delta` — text_delta / thinking_delta / input_json_delta
4. `content_block_stop` — close block before switching types
5. `message_delta` — stop_reason + usage
6. `message_stop` — end

Switches between text/thinking/tool_use mid-stream, closing previous blocks before opening new ones.

## Chat Completions → Responses Stream Details

**File:** `src/translate/stream/chat-completions-to-responses.ts`

Output item lifecycle:
1. `response.created` — emitted on first content
2. `response.output_item.added` — new text/reasoning/function_call item
3. `response.content_part.added` (text only)
4. `response.text.delta` / `response.reasoning_text.delta` / `response.function_call_arguments.delta`
5. `response.content_part.done` / `response.reasoning_text.done` / `response.function_call_arguments.done`
6. `response.output_item.done`
7. `response.completed` or `response.incomplete`

Special handling:
- `ThinkTagStripper` strips inline `` tags from text content
- `delta.reasoning_content` mapped to reasoning items (DeepSeek style)
- Empty priming `delta.content: ""` skipped to avoid spurious text blocks
- Tool calls tracked by `toolCallAccum` Map keyed by OpenAI index

## Known Edge Cases

- **Tool calls in streams**: OpenAI sends `tool_calls[]` as array in delta; Anthropic sends individual `tool_use` content blocks. Translation tracks state via `toolCallMap` / `oaiIndexToCbIndex`.
- **Thinking blocks**: DeepSeek uses `reasoning_content` in OpenAI format; Anthropic uses `thinking` content blocks. Must close previous blocks before switching.
- **Chunk boundaries**: SSE frames can be split across TCP chunks. Buffer incomplete frames and split on `\n\n`.
- **Usage forwarding**: Anthropic includes usage in `message_start` and `message_delta`; OpenAI includes usage in the final chunk. Both translators capture and forward usage stats.
- **Empty priming content**: OpenAI sends `delta.content: ""` before real content. Translators skip these to avoid creating spurious empty text blocks