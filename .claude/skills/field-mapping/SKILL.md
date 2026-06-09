---
name: field-mapping
description: "Comprehensive reference for Anthropic↔OpenAI AND OpenAI Responses API↔Chat Completions field mappings. Load this skill before: adding a new field to the translation layer, fixing a mapping bug, verifying that a field maps correctly in both directions, debugging a response shape mismatch, or writing a test for a new translator field. Covers: text/image/tool_use/tool_result/thinking content blocks, usage tokens (with cache_read/cache_creation distinction), cache control, stop reasons, Responses API input items, inline <think> tag handling (Minimax quirk)."
---

# Field Mapping Reference

Authoritative reference for the proxy's translation layer. **Load before any non-trivial translator change.**

| Format Pair | Request | Response | Stream |
|-------------|---------|----------|--------|
| **Anthropic ↔ OpenAI** | `request/{anthropic-to-openai,openai-to-anthropic}.ts` | `response/{anthropic-to-openai,openai-to-anthropic}.ts` | `stream/{anthropic-to-openai,openai-to-anthropic}.ts` |
| **Responses API ↔ Chat Completions** | `request/responses-to-chat-completions.ts` | `response/chat-completions-to-responses.ts` | `stream/chat-completions-to-responses.ts` |

---

## Content Block Mappings

### Text

| Anthropic | OpenAI Chat Completions | OpenAI Responses |
|-----------|------------------------|------------------|
| `{type:"text", text:"..."}` | `content: "..."` (string) or `{type:"text", text:"..."}` (part) | `{type:"input_text", text:"..."}` |
| `{type:"text", text:"...", cache_control:{type:"ephemeral"}}` | + `prompt_cache_key` from system prompt hash | Not directly mapped |

### Image

| Anthropic | OpenAI Chat Completions | OpenAI Responses |
|-----------|------------------------|------------------|
| `{type:"image", source:{type:"url", url:"..."}}` | `{type:"image_url", image_url:{url:"..."}}` | `{type:"input_image", image_url:{url:"..."}}` |
| `{type:"image", source:{type:"base64", media_type:"image/png", data:"..."}}` | `{type:"image_url", image_url:{url:"data:image/png;base64,..."}}` | `{type:"input_image", image_url:{url:"data:image/png;base64,..."}}` |
| (no equivalent) | (no equivalent) | `{type:"input_image", source:{type:"base64", media_type:"...", data:"..."}}` — must convert to `image_url` data URI |

**Rule:** `input_image` can carry image in EITHER `image_url` OR `source.{url,data,media_type}`. Both must produce a Chat Completions `image_url` data URI.

### Tool Use / Tool Calls

| Anthropic | OpenAI Chat Completions | OpenAI Responses |
|-----------|------------------------|------------------|
| `{type:"tool_use", id:"toolu_xxx", name:"fn", input:{...}}` | `{role:"assistant", tool_calls:[{id:"toolu_xxx", type:"function", function:{name:"fn", arguments:"{...}"}}]}` | Output `{type:"function_call", call_id:"toolu_xxx", name:"fn", arguments:"{...}"}` |
| `{type:"tool_result", tool_use_id:"toolu_xxx", content:"..."}` | `{role:"tool", tool_call_id:"toolu_xxx", content:"..."}` (separate message) | Input `{type:"function_call_output", call_id:"toolu_xxx", output:"..."}` |

**Rule:** Tool call IDs MUST be preserved: `tool_use_id` ↔ `tool_call_id` ↔ `call_id`.

### Thinking / Reasoning

| Anthropic | OpenAI Chat Completions | OpenAI Responses |
|-----------|------------------------|------------------|
| `{type:"thinking", thinking:"..."}` | `reasoning_content: "..."` (top-level field) | Output `{type:"reasoning", reasoning_text:"..."}` |
| Inline `<think>...</think>` (Minimax quirk) | Strip in translator | Strip in translator |

**Rule:** `reasoning_content` is top-level on the message, NOT a content part. DeepSeek `type:"reasoning"` items in Responses API input must buffer and merge with next assistant message.

### Cache Control

Anthropic → OpenAI doesn't have 1:1 mapping. The proxy hashes system prompt → sets `prompt_cache_key` for node-affinity caching. `extractUncachedInputTokens()` in `src/cache.ts` subtracts cached tokens to avoid double-counting.

---

## Usage Token Mappings

| Anthropic | OpenAI Chat Completions | Notes |
|-----------|------------------------|-------|
| `usage.input_tokens` | `usage.prompt_tokens` | Cached tokens reported separately |
| `usage.output_tokens` | `usage.completion_tokens` | |
| `usage.cache_read_input_tokens` | `usage.prompt_tokens_details.cached_tokens` | |
| `usage.cache_creation_input_tokens` | (no equivalent) | Set to 0 or omitted |

**Double-counting trap:** `prompt_tokens` INCLUDES cached tokens. If you also report `cache_read_input_tokens`, you count twice. Use `extractUncachedInputTokens()`.

```typescript
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
| `stop_reason: "max_tokens"` | `finish_reason: "length"` | Truncated |
| (no equivalent) | `finish_reason: "insufficient_system_resource"` | DeepSeek overcapacity → `status:"incomplete"` |

---

## Responses API Input Items

### `{type: "message", role: "user"|"system"|"developer"|"assistant", content: [...]}`

Content parts: `{type:"text"}`, `{type:"input_text"}`, `{type:"input_image"}` (with `image_url` or `source`), `{type:"image_url"}`.

Role mapping: `"developer"` → `"system"` (Chat Completions has no developer role).

### `{type: "reasoning", reasoning_text: "..."}` (DeepSeek)
Buffer `reasoning_text`. Merge with next `type:"message"` `role:"assistant"` by setting `reasoning_content`.

### `{type: "function_call_output", call_id: "...", output: "..."}`
→ `{role: "tool", tool_call_id: call_id, content: output}`

### `{type: "function_call", call_id: "...", name: "...", arguments: "..."}`
Merge with preceding assistant message's `tool_calls`, or create new assistant message.

### `instructions` (top-level)
Becomes system message at start of input array (unless `system`/`developer` already exists).

---

## Streaming Event Lifecycle (Quick Reference)

For full details, see `stream-debug` skill.

### Anthropic → OpenAI
For each `content_block_start`: open choice with delta → append on `content_block_delta` → close on `content_block_stop` → emit usage on `message_delta` → `data: [DONE]` on `message_stop`.

### OpenAI → Anthropic
For each delta: first content → `message_start` + `content_block_start` → `content_block_delta` → on finish → `content_block_stop` for any open block → `message_delta` → `message_stop`.

**Critical:** Every `content_block_start` MUST have matching `content_block_stop`. Block type switches require explicit stop before next start.

---

## The `originalModel` Invariant

The body's original `model` is preserved for the response translator even when routing overrides it. The client always sees what it sent.

```typescript
const originalModel = req.model;
if (route.modelOverride) req.model = route.modelOverride;
if (hasImages(req)) req.model = getVisionModel(upstream, req.model);
// Response translator uses originalModel, not the overridden one
```

---

## Common Bug Patterns (Responses API)

1. **Tool calls dropped from assistant content** (CRITICAL) — `translateAssistantContent()` must call `extractToolCalls()`.
2. **`input_text` content blocks dropped** (HIGH) — Filter must include `input_text`, not just `text`.
3. **`input_image` with `source.type:"base64"` dropped** (MEDIUM) — Must handle BOTH `image_url` and `source` shapes.
4. **Inline `<think>` tags in content** (HIGH) — Strip with state machine (`inThinkTag` + `thinkTagBuffer`).
5. **`finish_reason:"insufficient_system_resource"` not mapped** (MEDIUM) → `status:"incomplete"`.
