---
name: field-mapping
description: "Comprehensive reference for Anthropic↔OpenAI AND OpenAI Responses API↔Chat Completions field mappings. Load this skill before: adding a new field to the translation layer, fixing a mapping bug, verifying that a field maps correctly in both directions, debugging a response shape mismatch, or writing a test for a new translator field. Covers: text/image/tool_use/tool_result/thinking content blocks, usage tokens (with cache_read/cache_creation distinction), cache control, stop reasons, Responses API input items (string or array of message/reasoning/function_call_output), inline <think> tag handling (Minimax quirk)."
---

# Field Mapping Reference

Authoritative reference for the proxy's translation layer. **Load before any non-trivial translator change.** All 3 format pairs:

| Format Pair | Request Files | Response Files | Stream Files |
|-------------|---------------|----------------|--------------|
| **Anthropic ↔ OpenAI Chat Completions** | `request/{anthropic-to-openai,openai-to-anthropic}.ts` | `response/{anthropic-to-openai,openai-to-anthropic}.ts` | `stream/{anthropic-to-openai,openai-to-anthropic}.ts` |
| **OpenAI Responses API ↔ Chat Completions** | `request/responses-to-chat-completions.ts` | `response/chat-completions-to-responses.ts` | `stream/chat-completions-to-responses.ts` |

---

## Content Block Mappings

### Text

| Anthropic | OpenAI Chat Completions | OpenAI Responses |
|-----------|------------------------|------------------|
| `{type:"text", text:"..."}` | `content: "..."` (string) or `{type:"text", text:"..."}` (part) | `{type:"input_text", text:"..."}` |
| `{type:"text", text:"...", cache_control:{type:"ephemeral"}}` | + `prompt_cache_key` derived from system prompt hash | ⚠️ Not directly mapped — see Cache Control section |

### Image

| Anthropic | OpenAI Chat Completions | OpenAI Responses |
|-----------|------------------------|------------------|
| `{type:"image", source:{type:"url", url:"..."}}` | `{type:"image_url", image_url:{url:"..."}}` | `{type:"input_image", image_url:{url:"..."}}` |
| `{type:"image", source:{type:"base64", media_type:"image/png", data:"..."}}` | `{type:"image_url", image_url:{url:"data:image/png;base64,..."}}` | `{type:"input_image", image_url:{url:"data:image/png;base64,..."}}` |
| (no Anthropic equivalent) | (no Chat Completions equivalent) | `{type:"input_image", source:{type:"base64", media_type:"...", data:"..."}}` — Responses native format, must be converted to `image_url` data URI |

**Rule:** `input_image` can carry the image in EITHER `image_url` OR `source.{url,data,media_type}`. Both must produce a Chat Completions `image_url` data URI.

### Tool Use / Tool Calls

| Anthropic | OpenAI Chat Completions | OpenAI Responses |
|-----------|------------------------|------------------|
| `{type:"tool_use", id:"toolu_xxx", name:"fn", input:{...}}` (in assistant content) | `{role:"assistant", tool_calls:[{id:"toolu_xxx", type:"function", function:{name:"fn", arguments:"{...}"}}]}` (parallel structure) | Output item `{type:"function_call", call_id:"toolu_xxx", name:"fn", arguments:"{...}"}` |
| `{type:"tool_result", tool_use_id:"toolu_xxx", content:"..."}` (in user content) | `{role:"tool", tool_call_id:"toolu_xxx", content:"..."}` (separate message) | Input item `{type:"function_call_output", call_id:"toolu_xxx", output:"..."}` |

**Rule:** Tool call IDs MUST be preserved through the translation chain. `tool_use_id` ↔ `tool_call_id` ↔ `call_id`.

### Thinking / Reasoning

| Anthropic | OpenAI Chat Completions | OpenAI Responses |
|-----------|------------------------|------------------|
| `{type:"thinking", thinking:"..."}` (in assistant content) | `reasoning_content: "..."` (top-level field on assistant message) | Output item `{type:"reasoning", reasoning_text:"..."}` |
| Inline `<think>...</think>` inside text (Minimax quirk) | ⚠️ Strip in translator — `<think>` tags in `content` must be removed before sending to client | ⚠️ Strip in translator |

**Rule:** `reasoning_content` is a top-level field on the message, NOT a content part. DeepSeek `type:"reasoning"` items in Responses API input must be buffered and merged with the next assistant message.

### Cache Control

Anthropic → OpenAI doesn't have a 1:1 mapping. The proxy works around this by:
- Hashing the system prompt → setting `prompt_cache_key` on the request
- This routes requests with the same system prompt to the same OpenAI backend node, enabling automatic prefix caching

`extractUncachedInputTokens()` in `src/cache.ts` subtracts cached tokens from input tokens to avoid double-counting when mapping to Anthropic format.

---

## Usage Token Mappings

| Anthropic | OpenAI Chat Completions | Notes |
|-----------|------------------------|-------|
| `usage.input_tokens` | `usage.prompt_tokens` | Cached tokens are reported separately — see below |
| `usage.output_tokens` | `usage.completion_tokens` | |
| `usage.cache_read_input_tokens` | `usage.prompt_tokens_details.cached_tokens` | |
| `usage.cache_creation_input_tokens` | (no direct equivalent) | Set to 0 or omitted |

**Double-counting trap:** When mapping OpenAI → Anthropic, `prompt_tokens` INCLUDES the cached tokens (cached tokens are part of the prompt). If you also report `cache_read_input_tokens`, you're counting the same tokens twice. Use `extractUncachedInputTokens()` from `src/cache.ts` to subtract cached from input.

```typescript
// src/cache.ts
export function extractUncachedInputTokens(usage: any): number {
  const total = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
  const cached = usage?.prompt_tokens_details?.cached_tokens
              ?? usage?.cache_read_input_tokens ?? 0;
  return Math.max(0, total - cached);
}
```

---

## Stop Reason / Finish Reason Mappings

| Anthropic | OpenAI Chat Completions | Notes |
|-----------|------------------------|-------|
| `stop_reason: "end_turn"` | `finish_reason: "stop"` | Normal completion |
| `stop_reason: "tool_use"` | `finish_reason: "tool_calls"` | Model wants to call a tool |
| `stop_reason: "max_tokens"` | `finish_reason: "length"` | Truncated by token limit |
| `stop_reason: "stop_sequence"` | `finish_reason: "stop"` (with matched stop) | |
| (no Anthropic equivalent) | `finish_reason: "content_filter"` | Content moderation blocked the response |
| (no Anthropic equivalent) | `finish_reason: "insufficient_system_resource"` | DeepSeek overcapacity — map to `status:"incomplete"` in Responses API |

---

## OpenAI Responses API Input Items

The Responses API uses an `input` array (or string) with typed items. Each maps as follows:

### `{type: "message", role: "user"|"system"|"developer"|"assistant", content: [...]}`

`content` is an array of content parts. Each part:
- `{type: "text", text: "..."}` (Anthropic-style) — keep
- `{type: "input_text", text: "..."}` (Responses native) — keep
- `{type: "input_image", image_url: {...}}` → Chat Completions `image_url` part
- `{type: "input_image", source: {type:"base64", media_type:"...", data:"..."}}` → Chat Completions `image_url` data URI part
- `{type: "image_url", image_url: {...}}` (OpenAI-style) — keep

Role mapping:
- `"user"` → `"user"`
- `"system"` → `"system"`
- `"developer"` → `"system"` (Chat Completions has no developer role)
- `"assistant"` → `"assistant"`

### `{type: "reasoning", reasoning_text: "..."}` (DeepSeek)

Buffer the `reasoning_text`. When the next `type:"message"` with `role:"assistant"` arrives, merge by setting `reasoning_content` on the assistant message.

### `{type: "function_call_output", call_id: "...", output: "..."}`

→ `{role: "tool", tool_call_id: call_id, content: output}` message.

### `{type: "function_call", call_id: "...", name: "...", arguments: "..."}`

The proxy's own response translator outputs tool calls as separate `type:"function_call"` items. When these come back as input, they must be merged with the preceding assistant message (or create a new one) so that subsequent `function_call_output` items have a matching assistant `tool_calls` to pair with.

### `instructions` (top-level)

Becomes a system message at the start of the input array, unless a `system` or `developer` message already exists (deduplication).

---

## Streaming Event Lifecycle (Quick Reference)

For full SSE format details, see `stream-debug` skill. The minimum you need to know when modifying translators:

### Anthropic → OpenAI
For each Anthropic `content_block_start`:
1. Open a corresponding OpenAI choice with a delta
2. For each subsequent `content_block_delta`, append to the delta
3. On `content_block_stop`, close the choice
4. On `message_delta` with usage, emit final usage chunk
5. On `message_stop`, emit `data: [DONE]`

### OpenAI → Anthropic
For each OpenAI delta choice:
1. On first delta with content → emit `message_start` then `content_block_start`
2. On each content delta → emit `content_block_delta`
3. On `finish_reason: "tool_calls"` → emit `content_block_stop` for text (if any), then `tool_use` blocks
4. **On finish** → emit `content_block_stop` for any open block, then `message_delta` (with usage if present), then `message_stop`

**Critical:** Every `content_block_start` MUST have a matching `content_block_stop`. Switching between text/thinking/tool_use blocks requires a `content_block_stop` for the old type before `content_block_start` for the new type.

---

## The `originalModel` Invariant

When the routing layer overrides the model (e.g., URL path override, or image forcing), the **body's original `model` is preserved** for the response translator. The client always sees the model name it sent.

```typescript
// In src/index.ts:
const originalModel = req.model;  // e.g., "mimo-v2.5-free" (what the client sent)
if (route.modelOverride) req.model = route.modelOverride;  // e.g., "deepseek-v4-pro" (URL override)
if (hasImages(req)) req.model = getVisionModel(upstream);  // e.g., "qwen3.6-plus" (vision forcing)

// In response translator:
toOpenAIResponse(data, originalModel)  // ← originalModel, not the overridden one
```

**Why:** The client expects to see what it asked for in the response. If the client sent `model: "mimo-v2.5-free"` and we silently swapped to `qwen3.6-plus`, the response's `model` field would be wrong.

---

## Common Bug Patterns (Responses API)

These are the bugs that have actually shipped and been fixed. Add new ones as you find them.

1. **Tool calls dropped from assistant content** (CRITICAL) — `translateAssistantContent()` in `responses-to-chat-completions.ts` must call `extractToolCalls()` to handle embedded `tool_call` content blocks. The DeepSeek merge path did this; the plain assistant path didn't, silently dropping them. Always test that `function_call_output` items can find their matching `tool_calls`.

2. **`input_text` content blocks dropped** (HIGH) — `extractTextContent()` and `extractTextParts()` in `responses-to-chat-completions.ts` must include `input_text` in the filter, not just `text`.

3. **`input_image` with `source.type:"base64"` dropped** (MEDIUM) — Responses native format `{type:"input_image", source:{type:"base64", media_type, data}}` is different from `{type:"input_image", image_url:{url}}`. The translator must handle BOTH.

4. **Inline `<think>` tags in content** (HIGH) — Models like Minimax embed reasoning inside `<think>...</think>` tags within the response `content` field rather than using the standard `reasoning_content` field. The translator must strip these tags. The stream translator uses a state machine with `inThinkTag` + `thinkTagBuffer` to handle tags split across chunks.

5. **`finish_reason:"insufficient_system_resource"` not mapped** (MEDIUM) — DeepSeek overcapacity signal must become `status:"incomplete"` in the Responses API response, not `status:"failed"`.
