# Translation Layer Bug Fix Summary

## Verified: All 138 existing tests pass after fixes

### Fix #1 (Bug #7, MEDIUM) — Double-stringify `tool_use.input` in Anthropic→OpenAI request
- **File:** `src/translate/request/anthropic-to-openai.ts` (line 42)
- **What:** Changed `JSON.stringify(part.input)` to `typeof part.input === "string" ? part.input : JSON.stringify(part.input)`
- **Why:** If `part.input` is already a string (non-standard), `JSON.stringify` would add extra quotes, producing `'"already-string"'` instead of the original string.

### Fix #2 (Bug #3, HIGH) — `imageSourceFromUrl` always returns `type: "base64"`
- **File:** `src/translate/request/openai-to-anthropic.ts` (line 20)
- **What:** Changed fallback return from `{ type: "base64", media_type: "image/jpeg", data: url }` to `{ type: "url", url: url }`
- **Why:** For HTTP URLs (non-data-URIs), the function was incorrectly marking them as base64 data and sending the URL string as raw data to the Anthropic API.

### Fix #3 (Bug #1, CRITICAL) — `tool_choice` format mismatch (OpenAI → Anthropic)
- **File:** `src/translate/request/openai-to-anthropic.ts` (line 166)
- **What:** Added mapping logic:
  - Object format: `{type:"function", function:{name:"xxx"}}` → `{type:"tool", name:"xxx"}`
  - String: `"required"` (OpenAI) → `"any"` (Anthropic); `"auto"` and `"none"` pass through unchanged
- **Why:** OpenAI and Anthropic use different shapes for specific tool selection. Direct passthrough caused Anthropic to reject the request.

### Fix #4 (Bug #2, CRITICAL) — Tool calls silently dropped in Responses API assistant messages
- **File:** `src/translate/request/responses-to-chat-completions.ts` (function `translateAssistantContent`)
- **What:** Added `extractToolCalls(item)` call in the normal (non-DeepSeek) assistant message path
- **Why:** The function only extracted `output_text` blocks and ignored `tool_call` content blocks, silently dropping tool calls in non-DeepSeek responses.

### Fix #5 (Bug #4, MEDIUM) — Base64 `input_image.source` not handled in Responses API
- **File:** `src/translate/request/responses-to-chat-completions.ts` (function `translateUserContent`)
- **What:** Added `else if (src?.type === "base64")` branch that converts `{type:"base64", media_type, data}` to `data:` URI format
- **Why:** The Responses API native format for base64 images uses a `source` object, not `image_url.url`. The code only checked for `src?.url` and silently dropped base64 images.

### Fix #6 (Bug #5, MEDIUM) — First tool call streaming chunk loses arguments in Chat Completions → Responses
- **File:** `src/translate/stream/chat-completions-to-responses.ts` (line 244)
- **What:** Changed `else if (tc.function?.arguments)` to `if (tc.function?.arguments)`
- **Why:** When the first tool call chunk contains both `id` AND `function.arguments`, the `if (tc.id)` branch creates the accumulator with `args: ""` and the `else if` is skipped, losing the arguments from that same chunk.

### Fix #7 (Bug #6, MEDIUM) — Anthropic upstream cache tokens lost in Anthropic→OpenAI response
- **File:** `src/translate/response/anthropic-to-openai.ts` (usage mapping, lines 60-65)
- **What:** Changed usage mapping to:
  - Read `cache_read_input_tokens` / `cache_creation_input_tokens` from Anthropic usage
  - Include cached tokens in `prompt_tokens` (input + cached)
  - Include cached tokens in `total_tokens`
  - Add `prompt_tokens_details: { cached_tokens }` when `cached > 0`
- **Why:** The OpenAI client lost visibility into cache hits. Also `prompt_tokens` under-reported total input tokens.

### Fix #8 (Bug #8, LOW) — `content_filter` / `insufficient_system_resource` fallthrough to `end_turn`
- **File:** `src/translate/response/openai-to-anthropic.ts` (line 41)
- **What:** Added `else if (finishReason === "content_filter" || finishReason === "insufficient_system_resource") stopReason = "max_tokens";`
- **Why:** These finish reasons were silently mapping to `"end_turn"`, misleadingly suggesting the model completed normally when it was actually terminated early.

### Extra Fix (same class as Bug #7) — Double-stringify in Anthropic→OpenAI response
- **File:** `src/translate/response/anthropic-to-openai.ts` (line 24)
- **What:** Changed `JSON.stringify(block.input)` to `typeof block.input === "string" ? block.input : JSON.stringify(block.input)`
- **Why:** Same potential issue as Bug #7 — if `block.input` is already a string, `JSON.stringify` double-encodes it.
