---
name: field-mapping
description: "Comprehensive reference for Anthropic↔OpenAI field mappings in request/response translation. Use whenever adding a new field to the translation layer, fixing a mapping bug, or verifying that a field maps correctly in both directions. Includes special block types (tool_use, tool_result, thinking, image), usage tokens, cache control, and stop sequences."
---

# Anthropic↔OpenAI Field Mapping Reference

Detailed field-by-field mapping reference for request and response translation between Anthropic Messages API and OpenAI Chat Completions API. **Always check both directions when adding or modifying a field mapping.**

## Request: Anthropic → OpenAI

| Anthropic Field | Path | OpenAI Field | Path | Notes |
|----------------|------|-------------|------|-------|
| `model` | root | `model` | root | Direct passthrough |
| `system` | root | System message prepended | `messages[0]` | String → `{role:"system",content}`. Array of content blocks → concatenated text |
| `messages[].content` (string) | `messages[i].content` | `content` (string) | `messages[j].content` | Direct passthrough if string |
| `messages[].content[].text` | `messages[i].content[j]` | `content` (text string) | `messages[j].content` | Text block → flat string |
| `messages[].content[].tool_use` | `messages[i].content[j]` | `tool_calls[]` | `messages[j].tool_calls[n]` | `id` + `type:"function"` + `function:{name,arguments}` |
| `messages[].content[].tool_result` | `messages[i].content[j]` | New message `{role:"tool"}` | Separate message | Creates a separate message entry with `tool_call_id` |
| `messages[].content[].thinking` | `messages[i].content[j]` | `reasoning_content` | `messages[j].reasoning_content` | Only the assistant message's thinking block |
| `messages[].content[].image` | `messages[i].content[j]` | `image_url` content part | `messages[j].content[k]` | `source.type:"base64"` → `data:image/{media_type};base64,{data}` |
| `max_tokens` | root | `max_tokens` | root | Direct passthrough |
| `stream` | root | `stream` + `stream_options` | root | Set `stream_options: {include_usage:true}` |
| `stop_sequences` | root | `stop` | root | Array passthrough |
| `tools[]` | root | `tools[]` | root | `{name,description,input_schema}` → `{type:"function",function:{name,description,parameters}}` |
| `metadata.user_id` | root | `user` | root | Direct passthrough |
| `temperature` | root | `temperature` | root | Direct passthrough |
| `top_p` | root | `top_p` | root | Direct passthrough |
| `top_k` | root | `top_k` | root | Direct passthrough (OpenAI may ignore) |

### Header Handling

- `anthropic-version` → Not forwarded to OpenAI upstream
- `anthropic-beta` → Not forwarded to OpenAI upstream
- `x-api-key` → Mapped to `Authorization: Bearer {key}`

### Cache Control

- Anthropic `cache_control: {type:"ephemeral"}` on system → OpenAI `prompt_cache_key` (djb2 hash of system prompt text)
- Anthropic `cache_control` on messages → Not currently mapped (OpenAI doesn't support per-message caching)

## Request: OpenAI → Anthropic

| OpenAI Field | Path | Anthropic Field | Path | Notes |
|-------------|------|----------------|------|-------|
| `model` | root | `model` | root | Direct passthrough |
| `messages[0].role:"system"` | `messages[0]` | `system` | root | System role content extracted to top-level system |
| `messages[].content` (text) | `messages[j].content` | `messages[].content[].text` | `messages[i].content[k]` | Text → `{type:"text",text}` |
| `messages[].content[].image_url` | `messages[j].content[k]` | `messages[].content[].image` | `messages[i].content[l]` | `data:...` URI → `{type:"image",source:{type:"base64",media_type,data}}` |
| `messages[].role:"tool"` | `messages[j]` | `messages[].content[].tool_result` | `messages[i].content[l]` | Merged into the preceding user or after tool_call_id message. Fields: `tool_use_id`, `content`, `is_error` |
| `messages[].tool_calls` | `messages[j].tool_calls` | `messages[].content[].tool_use` | `messages[i].content[k]` | `id` + `type:"tool_use"` + `name` + `input`(parsed JSON) |
| `messages[].reasoning_content` | `messages[j]` | `messages[].content[].thinking` | `messages[i].content[k]` | `{type:"thinking",thinking}`. The `signature` and `type` fields from Anthropic's thinking may not be present in OpenAI format |
| `max_tokens` | root | `max_tokens` | root | Default to 4096 if absent |
| `stream` | root | `stream` | root | Direct passthrough |
| `stream_options` | root | (skip) | — | OpenAI-specific, not mapped |
| `stop` | root | `stop_sequences` | root | Array passthrough |
| `temperature` | root | `temperature` | root | Direct passthrough |
| `top_p` | root | `top_p` | root | Direct passthrough |
| `frequency_penalty` | root | (skip) | — | No direct Anthropic equivalent |
| `presence_penalty` | root | (skip) | — | No direct Anthropic equivalent |
| `tools[].function` | `tools[j].function` | `tools[]` | root | `{name,description,parameters}` → `{name,description,input_schema}` |
| `tool_choice` | root | `tool_choice` | root | `"auto"`, `"any"`, `{type:"tool",name:"..."}` |
| `user` | root | `metadata.user_id` | root | Direct passthrough |

## Response: Anthropic → OpenAI

| Anthropic Field | Path | OpenAI Field | Path | Notes |
|----------------|------|-------------|------|-------|
| `id` | root | `id` | root | Direct passthrough |
| `model` | root | `model` | root | Direct passthrough |
| `content[].text` | `content[i]` | `choices[0].message.content` | `choices[0].message` | Text blocks concatenated? First text block wins? Check test expectations |
| `content[].tool_use` | `content[j]` | `choices[0].message.tool_calls[]` | `choices[0].message` | Multiple tool_use blocks → multiple tool_calls entries |
| `content[].thinking` | `content[k]` | `choices[0].message.reasoning_content` | `choices[0].message` | Thinking block content |
| `stop_reason:"tool_use"` | root | `finish_reason:"tool_calls"` | `choices[0]` | |
| `stop_reason:"end_turn"` | root | `finish_reason:"stop"` | `choices[0]` | |
| `stop_reason:"max_tokens"` | root | `finish_reason:"length"` | `choices[0]` | |
| `stop_reason:"stop_sequence"` | root | `finish_reason:"stop"` | `choices[0]` | Mapped to stop (note: lossy) |
| `stop_sequence` | root | `stop_sequence` | `choices[0]` | Only present when stop_reason is "stop_sequence" |
| `usage.input_tokens` | root | `usage.prompt_tokens` | root | |
| `usage.output_tokens` | root | `usage.completion_tokens` | root | |
| `usage.cache_read_input_tokens` | root | (skip — no direct OpenAI equivalent) | | |
| `usage.cache_creation_input_tokens` | root | (skip) | | |

## Response: OpenAI → Anthropic

| OpenAI Field | Path | Anthropic Field | Path | Notes |
|-------------|------|----------------|------|-------|
| `id` | root | `id` | root | Direct passthrough |
| `model` | root | `model` | root | Direct passthrough |
| `choices[0].message.content` | `choices[0].message` | `content[].text` | `content[i]` | `{type:"text",text}` |
| `choices[0].message.reasoning_content` | `choices[0].message` | `content[].thinking` | `content[j]` | `{type:"thinking",thinking}` placed before text blocks |
| `choices[0].message.tool_calls` | `choices[0].message` | `content[].tool_use` | `content[k]` | Each tool_calls entry → one tool_use block |
| `choices[0].finish_reason:"tool_calls"` | `choices[0]` | `stop_reason:"tool_use"` | root | |
| `choices[0].finish_reason:"stop"` | `choices[0]` | `stop_reason:"end_turn"` | root | |
| `choices[0].finish_reason:"length"` | `choices[0]` | `stop_reason:"max_tokens"` | root | |
| `choices[0].stop_sequence` | `choices[0]` | `stop_sequence` | root | Only present when applicable |
| `usage.prompt_tokens` | root | `usage.input_tokens` | root | |
| `usage.completion_tokens` | root | `usage.output_tokens` | root | |
| `usage.prompt_tokens_details.cached_tokens` | root | `usage.cache_read_input_tokens` | root | |
| `usage.completion_tokens_details` | root | (skip) | | |
| `system_fingerprint` | root | (skip) | | |

## Stream Event Mapping

### Anthropic SSE → OpenAI SSE

| Anthropic Event | Anthropic Data | OpenAI data: line | Notes |
|----------------|---------------|-------------------|-------|
| `message_start` | `{type:"message_start",message:{id,model,content:[],usage:{...}}}` | Initial message frame | Not directly mapped; first `content_block_start` becomes first `data:` line |
| `content_block_start` | `{type:"content_block_start",index,content_block:{type:"text",text:""}}` | `data: {choices:[{delta:{content:""}}]}` | For text blocks |
| `content_block_start` | `{type:"content_block_start",index,content_block:{type:"tool_use",...}}` | `data: {choices:[{delta:{tool_calls:[...]}}]}` | For tool_use blocks |
| `content_block_delta` | `{type:"content_block_delta",index,delta:{type:"text",text:"..."}}` | `data: {choices:[{delta:{content:"..."}}]}` | Text delta |
| `content_block_delta` | `{type:"content_block_delta",index,delta:{type:"thinking",thinking:"..."}}` | `data: {choices:[{delta:{reasoning_content:"..."}}]}` | Thinking delta |
| `content_block_stop` | `{type:"content_block_stop",index}` | (no direct mapping) | Implicit: next block start or message_delta |
| `message_delta` | `{type:"message_delta",delta:{stop_reason,stop_sequence},usage:{...}}` | `data: {choices:[{finish_reason,delta:{}}],usage:{...}}` | Final or multi-chunk usage |
| `message_stop` | `{type:"message_stop"}` | `data: [DONE]` | Stream termination |

### OpenAI SSE → Anthropic SSE

| OpenAI `data:` Content | Anthropic Event | Anthropic Data | Notes |
|-----------------------|----------------|---------------|-------|
| First chunk with `role:"assistant"` | `message_start` | `{type:"message_start",message:{id,model,content:[],usage:{...}}}` | Only on first chunk |
| Chunk with `delta.content` present | `content_block_start` + `content_block_delta` | First: start, subsequent: delta | Infer block boundaries |
| Chunk with `delta.reasoning_content` | `content_block_start` + `content_block_delta` | Similar to text but `type:"thinking"` | Thinking blocks come before text in Anthropic |
| Chunk with `delta.tool_calls` | `content_block_start` + `content_block_delta` | `type:"tool_use"` | Each tool call index is a separate block |
| Switch between content types | `content_block_stop` for old type | Must emit stop before starting new type | **Common bug:** missing stop before switching |
| Chunk with `finish_reason` | `message_delta` | `delta:{stop_reason,stop_sequence},usage:{...}` | |
| `data: [DONE]` | `message_stop` | `{type:"message_stop"}` | Stream termination |

## Common Bug Patterns

1. **Missing `content_block_stop`** before switching between text/thinking/tool_use blocks in OpenAI→Anthropic streaming
2. **Wrong SSE event format** — Anthropic uses `event: <event_name>\ndata: <json>\n\n`; OpenAI uses `data: <json>\n\n`
3. **Missing `[DONE]`** at the end of OpenAI-style streams
4. **Missing `message_delta` + `message_stop`** at the end of Anthropic-style streams
5. **Usage token mismatch** — `prompt_tokens` mapped to both `input_tokens` and something else
6. **Cache token loss** — `prompt_tokens_details.cached_tokens` not mapped to `cache_read_input_tokens`
7. **Tool call in streaming** — tool_calls delta in OpenAI must produce proper Anthropic content_block_start/stop events
8. **originalModel not preserved** — response uses the overridden model instead of the original body model

---

## Responses API ↔ Chat Completions

The `/v1/responses` endpoint is a third upstream-facing format. Both directions are pure-function translators in `src/translate/{request,response}/`.

### Request: Responses API → Chat Completions

Source: `src/translate/request/responses-to-chat-completions.ts`

| Responses API Field | Path | Chat Completions Field | Path | Notes |
|--------------------|------|------------------------|------|-------|
| `model` | root | `model` | root | Direct passthrough |
| `instructions` | root | `{role:"system",content}` | `messages[0]` | Only prepended if no system/developer message already in `input` array |
| `input` (string) | root | `{role:"user",content}` | `messages[n]` | String `input` becomes a single user message |
| `input[]` (array of items) | root | Multiple messages | `messages[]` | See item-type mapping below |
| `input[].type:"message"` with `role:"system"` | `input[i]` | `{role:"system",content}` | `messages[k]` | Extracted from `item.content[]` text parts |
| `input[].type:"message"` with `role:"developer"` | `input[i]` | `{role:"system",content}` | `messages[k]` | Developer role maps to system (Chat Completions has no developer role) |
| `input[].type:"message"` with `role:"user"` | `input[i]` | `{role:"user",content}` | `messages[k]` | `content[]` may include `text` and `input_image` parts |
| `input[].type:"message"` with `role:"assistant"` | `input[i]` | `{role:"assistant",content,tool_calls?,reasoning_content?}` | `messages[k]` | `output_text` parts → text; embedded `tool_call` parts → `tool_calls[]` |
| `input[].type:"reasoning"` (DeepSeek) | `input[i]` | `reasoning_content` on the **next** assistant message | `messages[k].reasoning_content` | Buffered until the next assistant message arrives |
| `input[].type:"function_call_output"` | `input[i]` | `{role:"tool",tool_call_id,content}` | `messages[k]` | `call_id` → `tool_call_id`; `output` (string or object) → `content` |
| `input[].content[].type:"input_image"` with `image_url` | `input[i].content[j]` | `{type:"image_url",image_url:{url}}` | `messages[k].content[l]` | Direct passthrough |
| `input[].content[].type:"input_image"` with `source.type:"base64"` | `input[i].content[j]` | `{type:"image_url",image_url:{url:"data:...;base64,..."}}` | `messages[k].content[l]` | `media_type` + `data` → data URI |
| `max_output_tokens` | root | `max_tokens` | root | Renamed |
| `temperature`, `top_p`, `stream`, `stream_options`, `parallel_tool_calls`, `user`, `top_logprobs` | root | same | root | Direct passthrough |
| `thinking` (DeepSeek) | root | `thinking` | root | Direct passthrough |
| `tools[].type:"function"` | `tools[]` | `tools[].type:"function",function:{name,description,parameters,strict?}` | `tools[]` | `parameters` or `input_schema` → `parameters`; `strict` passed through if present |
| `tools[].type` ≠ `"function"` | `tools[]` | (skip) | — | Built-in tools (file_search, web_search, custom, mcp) are not mapped |
| `tool_choice` (string) | root | `tool_choice` | root | `"auto"`, `"none"`, `"required"` are shared |
| `tool_choice.type:"function"` | root | `{type:"function",function:{name}}` | root | Responses uses flat `{name}`; Chat Completions nests under `function.name` |
| `tool_choice` (other types) | root | `"auto"` if tools present else `"none"` | root | Default to safe value for unmapped types |
| `text.type:"json_object"` | root | `response_format.type:"json_object"` | root | Text format config |
| `prompt_cache_key` | root | `prompt_cache_key` | root | Direct passthrough |

**Key subtlety — DeepSeek reasoning merging:**
When the `input` array contains `{type:"reasoning"}` followed by `{type:"message",role:"assistant"}`, the translator buffers the reasoning and attaches it to the next assistant message as `reasoning_content`. If the assistant message contains embedded `tool_call` content blocks, those MUST be extracted via `extractToolCalls()` — silently dropping them is a CRITICAL bug.

### Request: Chat Completions → Responses API

There is no direct Chat Completions → Responses request translator; the proxy only accepts Responses API requests and translates to Chat Completions. To send a Chat Completions request in Responses API format, wrap the messages into the `input` array manually (or use a separate client-side adapter — out of scope for this proxy).

### Response: Chat Completions → Responses API

Source: `src/translate/response/chat-completions-to-responses.ts`

| Chat Completions Field | Path | Responses API Field | Path | Notes |
|------------------------|------|---------------------|------|-------|
| `choices[0].message.content` | `choices[0].message` | `output[].type:"message".content[].type:"output_text"` | `output[i].content[j]` | Wrapped in a message output item with a generated `id` |
| `choices[0].message.reasoning_content` (DeepSeek) | `choices[0].message` | `output[].type:"reasoning"` | `output[i]` (before message) | Separate reasoning output item, placed before the message item |
| `choices[0].message.tool_calls[]` | `choices[0].message` | `output[].type:"function_call"` | `output[i]` (after message) | Each tool call becomes a separate function_call output item |
| `choices[0].finish_reason:"stop"` | `choices[0]` | `status:"completed"` | root | |
| `choices[0].finish_reason:"tool_calls"` | `choices[0]` | `status:"completed"` | root | Both map to completed |
| `choices[0].finish_reason:"length"` | `choices[0]` | `status:"incomplete"` | root | |
| `choices[0].finish_reason:"content_filter"` | `choices[0]` | `status:"incomplete"` | root | |
| `choices[0].finish_reason:"insufficient_system_resource"` | `choices[0]` | `status:"incomplete"` | root | DeepSeek-specific finish reason |
| `usage` (via `mapUsage`) | root | `usage` | root | See `src/cache.ts:mapUsage` for field mapping |

### Common Bug Patterns (Responses API)

1. **Tool calls dropped in non-DeepSeek Responses assistant path** — `translateAssistantContent()` must call `extractToolCalls(item)` to handle embedded `tool_call` content blocks. The DeepSeek merge path does this correctly; the plain assistant path used to skip it. **CRITICAL class bug.**
2. **Base64 `input_image.source` not handled** — `translateUserContent()` must check `src.type === "base64"` and construct a `data:{media_type};base64,{data}` URI, not assume `image_url` is always present. **MEDIUM class bug.**
3. **First tool call chunk loses `arguments`** — In streaming, when a tool call chunk arrives with both `id` and `arguments` in the same delta, the argument accumulation must happen in the same handler that opens the item. **MEDIUM class bug.**
4. **`finish_reason:"insufficient_system_resource"` not handled** — DeepSeek-specific finish reason must map to `status:"incomplete"`, not fall through to the default `completed`. **LOW class bug.**
5. **Instructions prepended twice** — If `input[]` already contains a `system` or `developer` message, `instructions` must NOT be prepended; otherwise the system message appears twice. **LOW class bug.**
6. **Built-in tool types passed through** — `tools[]` items with `type` other than `"function"` (file_search, web_search, custom, mcp) must be filtered out; Chat Completions only supports function tools. **LOW class bug.**
