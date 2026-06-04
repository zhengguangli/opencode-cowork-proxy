# Translation Layer Bug Diagnosis Report

Generated: 2026-06-04

Scope: All 6 translation files + 3 stream files + cache.ts + index.ts wiring.

---

## CRITICAL

### 1. `tool_choice` format mismatch — OpenAI format passed directly to Anthropic

**File:** `src/translate/request/openai-to-anthropic.ts`
**Line:** 166
**Severity:** CRITICAL

**Problem:**
Line 166 does a direct passthrough: `if (tool_choice !== undefined) anthropicRequest.tool_choice = tool_choice;`. OpenAI and Anthropic use **different shapes** for specific tool selection:

| Format | OpenAI | Anthropic |
|--------|--------|-----------|
| String | `"auto"`, `"none"`, `"required"` | `"auto"`, `"any"`, `"tool"` |
| Object | `{type:"function", function:{name:"xxx"}}` | `{type:"tool", name:"xxx"}` |

When a client sends `{type:"function", function:{name:"get_weather"}}`, the proxy forwards it verbatim to the Anthropic upstream. Anthropic will reject or ignore this because it expects `{type:"tool", name:"get_weather"}`.

Additionally, the string values `"required"` and `"any"` do not match — OpenAI uses `"required"`, Anthropic uses `"any"`.

**Fix:**
Map the OpenAI tool_choice shape to Anthropic before forwarding:

```typescript
if (tool_choice !== undefined) {
  if (typeof tool_choice === "object" && tool_choice.type === "function") {
    anthropicRequest.tool_choice = { type: "tool", name: tool_choice.function?.name };
  } else if (typeof tool_choice === "string") {
    // "required" in OpenAI === "any" in Anthropic
    const anthyMap: Record<string, string> = { auto: "auto", none: "none", required: "any" };
    anthropicRequest.tool_choice = anthyMap[tool_choice] || tool_choice;
  } else {
    anthropicRequest.tool_choice = tool_choice;
  }
}
```

**Test suggestion:**
```typescript
// OpenAI → Anthropic request with specific tool_choice
const result = formatOpenAIToAnthropic({
  model: "gpt-4",
  messages: [{ role: "user", content: "Hi" }],
  tool_choice: { type: "function", function: { name: "get_weather" } },
});
expect(result.tool_choice).toEqual({ type: "tool", name: "get_weather" });
```

---

### 2. Tool calls silently dropped in Responses API assistant messages (non-DeepSeek path)

**File:** `src/translate/request/responses-to-chat-completions.ts`
**Lines:** 74-77
**Severity:** CRITICAL

**Problem:**
When processing assistant messages from Responses API input, there are two code paths:

1. **DeepSeek merge path** (line 44-62): Calls `extractToolCalls(item)` to handle tool calls — **correct**.
2. **Normal assistant path** (line 74-77): Calls `translateAssistantContent(item)` which only extracts `output_text` content blocks and **completely ignores any `tool_call` content blocks** in the message content.

If a non-DeepSeek client sends an assistant message with embedded tool calls via Responses API, those tool calls are silently dropped during translation to Chat Completions format.

**Fix:**
Modify `translateAssistantContent` (or the calling code) to also extract tool calls:

```typescript
function translateAssistantContent(item: any): any {
  const content = item.content || [];
  const text = content.filter((p: any) => p.type === "output_text")
    .map((p: any) => p.text || "").join("\n");
  const toolCalls = extractToolCalls(item);

  const assistantMsg: any = { role: "assistant" };
  assistantMsg.content = text || null;
  if (toolCalls.length > 0) {
    assistantMsg.tool_calls = toolCalls;
  }
  return assistantMsg;
}
```

**Test suggestion:**
```typescript
const result = formatResponsesToChatCompletions({
  model: "gpt-4",
  input: [{
    type: "message", role: "assistant",
    content: [
      { type: "output_text", text: "Let me search" },
      { type: "tool_call", id: "tc1", name: "search", arguments: '{"q":"weather"}' },
    ],
  }],
});
expect(result.messages[0].tool_calls).toBeDefined();
expect(result.messages[0].tool_calls[0].function.name).toBe("search");
```

---

## HIGH

### 3. `imageSourceFromUrl` always returns `type: "base64"` even for URL images

**File:** `src/translate/request/openai-to-anthropic.ts`
**Lines:** 15-22
**Severity:** HIGH

**Problem:**
The function unconditionally returns `{type: "base64", media_type: "image/jpeg", data: url}`. It only checks for data URLs to extract the real media_type, but for regular HTTP URLs (e.g., `https://example.com/photo.jpg`), it incorrectly outputs:

```
{ type: "base64", media_type: "image/jpeg", data: "https://example.com/photo.jpg" }
```

This would send the URL string as base64 data to the Anthropic API, which will fail or produce garbage.

**Fix:**
```typescript
function imageSourceFromUrl(url: string | undefined): any {
  const match = (url || "").match(/^data:([^;]+);base64,(.*)$/);
  if (match) {
    return { type: "base64", media_type: match[1], data: match[2] };
  }
  // Not a data URL → use URL type
  return { type: "url", url: url || "" };
}
```

**Test suggestion:**
```typescript
// URL image
const result = formatOpenAIToAnthropic({
  model: "gpt-4",
  messages: [{
    role: "user",
    content: [{ type: "image_url", image_url: { url: "https://example.com/cat.jpg" } }],
  }],
});
expect(result.messages[0].content[0].source).toEqual({
  type: "url",
  url: "https://example.com/cat.jpg",
});
```

---

## MEDIUM

### 4. Base64 source in `input_image` not handled (Responses API → Chat Completions)

**File:** `src/translate/request/responses-to-chat-completions.ts`
**Function:** `translateUserContent` (lines 203-212)
**Severity:** MEDIUM

**Problem:**
In the Responses API, `input_image` content blocks can have either:
- `image_url: { url: "data:...base64,..." }` — currently handled
- `source: { type: "base64", media_type: "image/png", data: "..." }` — **NOT handled**

When `part.type === "input_image"`, the code checks `src.url` only. If the source uses the `source` object format (which is the native Responses API representation for base64 images), the code silently drops the image.

**Fix:**
Add handling for the `source` object format:

```typescript
} else if (part.type === "input_image") {
  hasImages = true;
  const src = part.image_url || part.source;
  if (src?.url) {
    // URL-based image
    parts.push({ type: "image_url", image_url: { url: src.url } });
  } else if (src?.type === "base64") {
    // Source-based image (Responses API native format)
    parts.push({
      type: "image_url",
      image_url: { url: `data:${src.media_type};base64,${src.data}` },
    });
  }
}
```

**Test suggestion:**
```typescript
const result = formatResponsesToChatCompletions({
  model: "qwen3.6-plus",
  input: [{
    type: "message", role: "user",
    content: [{
      type: "input_image",
      source: { type: "base64", media_type: "image/png", data: "abc123" },
    }],
  }],
});
expect(result.messages[0].content[0].type).toBe("image_url");
```

---

### 5. First tool call streaming chunk loses arguments when they arrive together with `id`

**File:** `src/translate/stream/chat-completions-to-responses.ts`
**Lines:** 238-261
**Severity:** MEDIUM

**Problem:**
The tool call handling uses an `if/else if` pattern:

```typescript
if (tc.id) {
  // New tool call
  if (activeItemType) flushActiveItem();
  startToolCallItem(tc.index, tc.id, tc.function?.name || "");
} else if (tc.function?.arguments) {
  // Accumulating arguments
  const acc = toolCallAccum.get(tc.index);
  ...
}
```

When a tool call chunk contains **both** `id` AND `function.arguments` in the same delta, the code enters the `if (tc.id)` branch and calls `startToolCallItem` which initializes `args: ""`. The arguments from the same chunk are not accumulated because the `else if` branch is skipped. The item is created with empty arguments, and the arguments from the first chunk are lost.

Most providers send `arguments: ""` in the first chunk, but this is not guaranteed.

**Fix:**
After the `if (tc.id)` block, also check for initial arguments:

```typescript
if (tc.id) {
  if (activeItemType) flushActiveItem();
  startToolCallItem(tc.index, tc.id, tc.function?.name || "");
}
if (tc.function?.arguments) { // not else if
  const acc = toolCallAccum.get(tc.index);
  if (acc) {
    acc.args += tc.function.arguments;
    const item = outputItems[outputItems.length - 1];
    if (item?.type === "function_call") {
      item.arguments = acc.args;
    }
    enqueueSSE(controller, "response.function_call_arguments.delta", {
      type: "response.function_call_arguments.delta",
      delta: tc.function.arguments,
      index: tc.index,
    });
  }
}
```

**Test suggestion:**
```typescript
// First chunk has both id AND arguments
const source = sseStream(
  'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":null}}]}\n\n',
  'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\\"city\\":\\"Paris\\"}"}}]}}]}\n\n',
  'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
  'data: [DONE]\n\n',
);
const result = await collectStream(streamChatCompletionsToResponses(source, "test"));
expect(result).toContain('"arguments":"{\\"city\\":\\"Paris\\"}"');
```

---

### 6. Anthropic upstream cache tokens lost when converting to OpenAI response format

**File:** `src/translate/response/anthropic-to-openai.ts`
**Lines:** 60-65
**Severity:** MEDIUM

**Problem:**
When the Anthropic upstream returns usage with `cache_read_input_tokens`, the response translator maps only `input_tokens` and `output_tokens` to OpenAI format. The `cache_read_input_tokens` is not mapped to OpenAI's `prompt_tokens_details.cached_tokens`. The OpenAI client loses visibility into cache hits.

```typescript
usage: response.usage
  ? {
      prompt_tokens: extractInputTokens(response.usage),      // maps from input_tokens
      completion_tokens: extractOutputTokens(response.usage),  // maps from output_tokens
      total_tokens: input + output,
    }
  : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
```

If the upstream returns `{input_tokens: 800, output_tokens: 50, cache_read_input_tokens: 200}`, the output would be `{prompt_tokens: 800, completion_tokens: 50, total_tokens: 850}` — without any indication that 200 tokens were cached. Additionally, `prompt_tokens: 800` is the uncached count, which under-reports total input (the OpenAI format expects `prompt_tokens` to include cached + uncached).

**Fix:**
```typescript
usage: response.usage
  ? (() => {
      const input = extractInputTokens(response.usage);
      const output = extractOutputTokens(response.usage);
      const cached = response.usage.cache_read_input_tokens || response.usage.cache_creation_input_tokens || 0;
      const result: any = { prompt_tokens: input + cached, completion_tokens: output, total_tokens: input + output + cached };
      if (cached > 0) {
        result.prompt_tokens_details = { cached_tokens: cached };
      }
      return result;
    })()
  : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
```

**Test suggestion:**
```typescript
const result = formatAnthropicToOpenAI({
  content: [{ type: "text", text: "Hello" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 800, output_tokens: 50, cache_read_input_tokens: 200 },
}, "claude");
expect(result.usage.prompt_tokens).toBe(1000);
expect(result.usage.prompt_tokens_details.cached_tokens).toBe(200);
```

---

### 7. Potential double-stringify of `tool_use.input` in Anthropic→OpenAI request

**File:** `src/translate/request/anthropic-to-openai.ts`
**Line:** 42
**Severity:** MEDIUM

**Problem:**
Line 42 unconditionally stringifies: `arguments: JSON.stringify(part.input)`. If `part.input` is already a string (non-standard but possible from some providers), `JSON.stringify` would add extra quotes around it, resulting in `'"already-a-string"'`.

The Anthropic Messages API specifies `tool_use.input` as an object, so this should not trigger in practice. But the code is not defensive.

**Fix:**
```typescript
arguments: typeof part.input === "string" ? part.input : JSON.stringify(part.input),
```

**Test suggestion:**
```typescript
// Edge case: input is already string
const result = formatAnthropicToOpenAI({
  model: "some-model",
  messages: [{
    role: "assistant",
    content: [{ type: "tool_use", id: "t1", name: "search", input: '{"q":"test"}' }],
  }],
  max_tokens: 100,
});
expect(result.messages[0].tool_calls[0].function.arguments).toBe('{"q":"test"}');
// Not '"{\\"q\\":\\"test\\"}"' (double-stringified)
```

---

## LOW

### 8. `finish_reason: "content_filter"` mapped to misleading `stop_reason: "end_turn"`

**File:** `src/translate/response/openai-to-anthropic.ts`
**Lines:** 37-41
**Severity:** LOW

**Problem:**
```typescript
let stopReason = "end_turn";  // default
if (finishReason === "tool_calls") stopReason = "tool_use";
else if (finishReason === "length") stopReason = "max_tokens";
else if (finishReason === "stop") stopReason = "end_turn";
```

When `finish_reason` is `"content_filter"` (OpenAI moderation filter), `"insufficient_system_resource"` (DeepSeek), or any unknown value, the code defaults to `"end_turn"`. This is misleading — the response was NOT an end_turn, it was terminated early.

Anthropic does not have a direct equivalent for `content_filter`, so the best option is to map to `"max_tokens"` or use a generic fallback.

**Fix:**
```typescript
if (finishReason === "content_filter" || finishReason === "insufficient_system_resource") {
  stopReason = "max_tokens";
}
```
Place this before the default `end_turn`.

**Test suggestion:**
```typescript
const result = formatOpenAIToAnthropic({
  choices: [{ message: { content: "partial" }, finish_reason: "content_filter" }],
}, "gpt-4");
expect(result.stop_reason).toBe("max_tokens");
```

---

## Additional Observations (Not Bugs)

### A. Anthropic system cache_control markers are dropped on purpose

Per CLAUDE.md, this is intentional. OpenAI uses automatic prefix caching, and the code injects `prompt_cache_key` instead. No action needed.

### B. `max_tokens || 4096` in OpenAI→Anthropic request

Line 135 of `openai-to-anthropic.ts`: `max_tokens: max_tokens || 4096`. If `max_tokens` is `0`, this would default to `4096` because `0 || 4096` evaluates to `4096`. Anthropic requires `max_tokens >= 1`, so a value of `0` would be invalid anyway. This is acceptable behavior.

### C. Anthropic `stop_sequences` mapped to OpenAI `stop`

Line 105 of `anthropic-to-openai.ts`: `if (stop_sequences) data.stop = stop_sequences;`. This assumes `stop_sequences` is an array, which it always is in Anthropic format. Correct.

### D. `response_format` passthrough in OpenAI→Anthropic request

Line 167 of `openai-to-anthropic.ts`: `if (response_format !== undefined) anthropicRequest.response_format = response_format;`. Anthropic supports `{type: "json_object"}` natively. The passthrough is correct for this simple case, but `{type: "json_schema", json_schema: {...}}` may not be supported by all Anthropic upstreams. This is a known limitation, not a bug.

---

## Summary Table

| # | Severity | File | Line(s) | Description |
|---|----------|------|---------|-------------|
| 1 | CRITICAL | `request/openai-to-anthropic.ts` | 166 | `tool_choice` format mismatch (OpenAI → Anthropic) |
| 2 | CRITICAL | `request/responses-to-chat-completions.ts` | 74-77 | Tool calls dropped in normal assistant path |
| 3 | HIGH | `request/openai-to-anthropic.ts` | 15-22 | `imageSourceFromUrl` always returns base64 type |
| 4 | MEDIUM | `request/responses-to-chat-completions.ts` | 203-212 | Base64 `input_image.source` not handled |
| 5 | MEDIUM | `stream/chat-completions-to-responses.ts` | 238-261 | First tool call chunk loses `arguments` |
| 6 | MEDIUM | `response/anthropic-to-openai.ts` | 60-65 | Cache tokens lost in Anthropic→OpenAI usage |
| 7 | MEDIUM | `request/anthropic-to-openai.ts` | 42 | Potential double-stringify of tool_use.input |
| 8 | LOW | `response/openai-to-anthropic.ts` | 37-41 | `content_filter` fallthrough to `end_turn` |
