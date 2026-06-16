---
name: format-translation
description: >
  API format translation gateway. Translates request/response/stream between
  Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses API formats.
  Triggers on: "translation issue", "format conversion", "API bridge",
  "Anthropic OpenAI mapping", "添加格式对", "翻译层", "格式转换", "新 FormatPair",
  "翻译问题", "流式翻译".
capabilities:
  - translation
  - streaming
  - code-gen
---

# Format Translation Skill

## Core Architecture

All translation logic lives in `src/translate/` as **pure functions** — no global state, no side effects, no I/O. Each function takes a deserialized object and returns a new object (or `ReadableStream`). Handlers in `src/handlers/` own the HTTP lifecycle and call these pure translators.

```
src/handlers/          <- HTTP lifecycle, auth, routing, fetch
src/translate/         <- Pure functions only
  request/             <- body -> body
  response/            <- body -> body
  stream/              <- ReadableStream -> ReadableStream
```

**Invariants:**
- Translators never import from `src/handlers/`
- Translators never do `fetch` or auth
- Translators never mutate input — always return new objects
- All runtime type narrowing uses `src/translate/type-guards.ts`

## Format Pairs

| FormatPairKey | Request Translator | Response Translator | Stream Translator |
|---|---|---|---|
| `AnthropicToOpenAI` | `formatAnthropicToOpenAI` (`request/anthropic-to-openai.ts`) | `formatAnthropicToOpenAI` (`response/anthropic-to-openai.ts`) | `streamAnthropicToOpenAI` (`stream/anthropic-to-openai.ts`) |
| `OpenAIToAnthropic` | `formatOpenAIToAnthropic` (`request/openai-to-anthropic.ts`) | `formatOpenAIToAnthropic` (`response/openai-to-anthropic.ts`) | `streamOpenAIToAnthropic` (`stream/openai-to-anthropic.ts`) |
| `ResponsesToChat` | `formatResponsesToChatCompletions` (`request/responses-to-chat-completions.ts`) | `formatChatCompletionsToResponses` (`response/chat-completions-to-responses.ts`) | `streamChatCompletionsToResponses` (`stream/chat-completions-to-responses.ts`) |

Each pair is registered in `src/translate/registry.ts` via `registerBuiltinTranslators()`. The `FormatPairKey` enum is in `src/translate/plugin.ts`.

## Dual-Path Handler Design

Each handler has two modes determined by the upstream format (`fmt`):

| Handler | File | Path 1 | Path 2 |
|---|---|---|---|
| `/v1/messages` | `src/handlers/messages.ts` | `fmt=openai` -> translate to OpenAI, send to `/v1/chat/completions` | `fmt=anthropic` -> pass-through to `/v1/messages` |
| `/v1/chat/completions` | `src/handlers/chat-completions.ts` | `fmt=anthropic` -> translate to Anthropic, send to `/v1/messages` | `fmt!=anthropic` -> pass-through to `/v1/chat/completions` |
| `/v1/responses` | `src/handlers/responses.ts` | One-directional: Responses->Chat Completions->upstream->Responses | — |

The Responses API path is **one-directional** — it always translates to Chat Completions for upstream and back to Responses format for the client.

## Vision/Image Routing

Image detection happens **before** translation in handlers. `src/vision.ts` provides per-format detectors:

| Function | Format | Image Block Type |
|---|---|---|
| `hasImages(body)` | Anthropic Messages | `type: "image"` |
| `hasOpenAIImages(body)` | OpenAI Chat Completions | `type: "image_url"` |
| `hasResponsesImages(body)` | Responses API | `type: "input_image"` / `"image_url"` |
| `hasAnyImageInMessages(body)` | Generic (pass-through) | Both `"image"` and `"image_url"` |
| `rawBodyMayHaveImages(raw)` | Pre-parse fast check | String scan for `"image"` or `"image_url"` |

When images are detected, `getVisionModel()` overrides the model to a vision-capable variant. This override runs **before** DeepSeek thinking injection (Responses handler).

Request translators handle image mapping:
- `request/anthropic-to-openai.ts`: `translateImageBlock()` — Anthropic `{type:"image", source:{...}}` -> OpenAI `{type:"image_url", image_url:{url:...}}`
- `request/openai-to-anthropic.ts`: `imageSourceFromUrl()` — OpenAI `image_url` -> Anthropic `source` (base64 or URL)
- `request/responses-helpers.ts`: `translateUserContent()` — Responses `input_image`/`image_url` -> OpenAI `image_url`

## Known Edge Cases

| Edge Case | Handling | File |
|---|---|---|
| DeepSeek `reasoning_content` | Mapped to Anthropic `thinking` block; Responses `reasoning` item | `stream/openai-to-anthropic.ts`, `response/openai-to-anthropic.ts`, `stream/chat-completions-to-responses.ts` |
| DeepSeek `insufficient_system_resource` | Maps to `max_tokens` (Anthropic) / `incomplete` (Responses) | `stream/finish-reason.ts`, `response/chat-completions-to-responses.ts` |
| Anthropic `thinking` + `signature` | Pass-through in request; `signature: ""` synthesized in response | `request/anthropic-to-openai.ts`, `response/openai-to-anthropic.ts` |
| Tool call argument accumulation | Streaming tool calls accumulated per `contentBlockIndex` (Anthropic) or `toolCall.index` (OpenAI) | `stream/anthropic-to-openai.ts`, `stream/openai-to-anthropic.ts` |
| `tool_choice` mapping | Anthropic `"any"` <-> OpenAI `"required"`; Anthropic `{type:"tool",name}` <-> OpenAI `{type:"function",function:{name}}` | `request/anthropic-to-openai.ts`, `request/openai-to-anthropic.ts` |
| Anthropic `system` as array | Multi-system blocks mapped to multiple system messages or concatenated | `request/anthropic-to-openai.ts` |
| Empty priming content | Empty `delta.content` or `delta.reasoning_content` skipped to avoid spurious empty blocks | `stream/openai-to-anthropic.ts`, `stream/chat-completions-to-responses.ts` |
| `prompt_cache_key` | Hash of system prompt injected for OpenAI prefix caching | `request/anthropic-to-openai.ts` |
| Inline think tags in text | `ThinkTagStripper` strips `` from content in Responses stream | `stream/chat-completions-to-responses.ts`, `src/think-tag-stripper.ts` |
| Responses API `function_call` in input | Merged with preceding assistant message or create new assistant message | `request/responses-to-chat-completions.ts` |
| `store` passthrough | OpenAI Responses `store` field passed through to Chat Completions request | `request/responses-to-chat-completions.ts` |

## Adding a New FormatPair

Step-by-step guide for adding, e.g., a `GeminiToChat` format pair:

### 1. Define the FormatPairKey

In `src/translate/plugin.ts`, add to the enum:

```typescript
export enum FormatPairKey {
  AnthropicToOpenAI = 'anthropic-to-openai',
  OpenAIToAnthropic = 'openai-to-anthropic',
  ResponsesToChat = 'responses-to-chat',
  GeminiToChat = 'gemini-to-chat',
}
```

### 2. Create the translation functions

Create 3 files under `src/translate/`:

```
src/translate/
  request/gemini-to-chat-completions.ts   <- formatGeminiToChatCompletions(body): Record<string, unknown>
  response/chat-completions-to-gemini.ts  <- formatChatCompletionsToGemini(body, model): Record<string, unknown>
  stream/chat-completions-to-gemini.ts    <- streamChatCompletionsToGemini(stream, model): ReadableStream
```

Each translator adheres to its interface from `plugin.ts`:

```typescript
// request -- RequestTranslator
export function formatGeminiToChatCompletions(body: Record<string, unknown>): Record<string, unknown> {
  // pure function, no mutations
}

// response -- ResponseTranslator
export function formatChatCompletionsToGemini(body: Record<string, unknown>, model: string): Record<string, unknown> {
  // pure function, no mutations
}

// stream -- StreamTranslator
export function streamChatCompletionsToGemini(stream: ReadableStream, model: string): ReadableStream {
  // return new ReadableStream({ async start(controller) { ... } })
  // use createSseEncoder() from stream/sse-encoder.ts for Anthropic/Responses-style SSE
  // use raw TextEncoder for OpenAI-style SSE
  // use parseSseFrame() / parseSseBuffer() from stream/sse-parser.ts for parsing input
  // use applyBackpressure() from src/backpressure.ts in read loops
}
```

Use type guards from `src/translate/type-guards.ts` (`asRecord`, `asRecordArray`, `asRecordOptional`) for all runtime narrowing.

### 3. Export from barrel file

In `src/translate/index.ts`, add:

```typescript
export { formatGeminiToChatCompletions } from './request/gemini-to-chat-completions';
export { formatChatCompletionsToGemini as toGeminiResponse } from './response/chat-completions-to-gemini';
export { streamChatCompletionsToGemini } from './stream/chat-completions-to-gemini';
```

### 4. Register the FormatPair

In `src/translate/registry.ts`, add:

```typescript
import { formatGeminiToChatCompletions } from './request/gemini-to-chat-completions';
import { formatChatCompletionsToGemini } from './response/chat-completions-to-gemini';
import { streamChatCompletionsToGemini } from './stream/chat-completions-to-gemini';

const geminiToChatRequestTranslator: RequestTranslator = {
  name: 'Gemini -> Chat Completions',
  sourceFormat: 'gemini',
  targetFormat: 'openai-chat',
  translate: (body) => formatGeminiToChatCompletions(body),
};

const chatToGeminiResponseTranslator: ResponseTranslator = {
  name: 'Chat Completions -> Gemini',
  sourceFormat: 'openai-chat',
  targetFormat: 'gemini',
  translate: (body, model) => formatChatCompletionsToGemini(body, model),
};

const chatToGeminiStreamTranslator: StreamTranslator = {
  name: 'Chat Completions SSE -> Gemini SSE',
  sourceFormat: 'openai-chat-sse',
  targetFormat: 'gemini-sse',
  translate: (stream, model) => streamChatCompletionsToGemini(stream, model),
};

const geminiToChatPair: FormatPair = {
  key: FormatPairKey.GeminiToChat,
  label: 'Gemini <-> Chat Completions',
  request: geminiToChatRequestTranslator,
  response: chatToGeminiResponseTranslator,
  stream: chatToGeminiStreamTranslator,
};

export function registerBuiltinTranslators(): void {
  translatorRegistry.register(anthropicToOpenAIPair);
  translatorRegistry.register(openAIToAnthropicPair);
  translatorRegistry.register(responsesToChatPair);
  translatorRegistry.register(geminiToChatPair);
}
```

### 5. Add handler

Create `src/handlers/gemini.ts` following the pattern from `src/handlers/messages.ts`. Use `translatorRegistry.get(FormatPairKey.GeminiToChat)` to resolve translators.

### 6. Add tests

Follow the naming pattern `test/<topic>.test.ts`. Create:
- `test/gemini-request.test.ts` — request translation unit tests
- `test/gemini-response.test.ts` — response translation unit tests
- `test/gemini-stream.test.ts` — stream translation unit tests
- `test/gemini-api.test.ts` — integration test via the handler

## Test Coverage Map

| Test File | Coverage |
|---|---|
| `test/anthropic-to-openai-request.test.ts` | `formatAnthropicToOpenAI` request: text, content arrays, images, tool_use, tool_result, system, metadata, tool_choice, cache_key |
| `test/openai-to-anthropic-request.test.ts` | `formatOpenAIToAnthropic` request: system extraction, image URL/base64, tool_calls, tool_choice, standalone tool messages, response_format |
| `test/response.test.ts` | `formatOpenAIToAnthropic` + `formatAnthropicToOpenAI` responses: text, reasoning_content, tool_calls, finish_reason mapping, cache token mapping |
| `test/stream.test.ts` | `streamOpenAIToAnthropic` + `streamAnthropicToOpenAI`: text deltas, tool call lifecycle, reasoning_content, usage forwarding, error handling, empty content |
| `test/responses-request.test.ts` | `formatResponsesToChatCompletions` request: string/array input, instructions, tool_choice mapping, DeepSeek reasoning, function_call items, text config, store passthrough |
| `test/responses-response.test.ts` | `formatChatCompletionsToResponses` response: text, reasoning_content, tool_calls, finish_reason-to-status mapping |
| `test/responses-stream.test.ts` | `streamChatCompletionsToResponses`: text deltas, reasoning deltas, tool call lifecycle, usage in completed event, error-to-incomplete |
| `test/responses-api.test.ts` | Integration: full `/v1/responses` round-trip (streaming + non-streaming), vision model override, DeepSeek thinking auto-injection |
| `test/plugin.test.ts` | `TranslatorRegistry`: register, get, getHandlerTranslators, has, unregister, clear, overwrite; `registerBuiltinTranslators` + `ensureTranslatorsRegistered` |
| `test/vision.test.ts` | Image detection across all 3 formats, `getVisionModel`, `rawBodyMayHaveImages`, edge cases |
| `test/model-override.test.ts` | Model override chain (URL param -> vision detection -> thinking injection) |
| `test/routing.test.ts` | Request routing to correct handler based on path and upstream format |

## Translation Module Structure

```
src/translate/
+-- index.ts                              <- Barrel exports (9 functions)
+-- plugin.ts                             <- FormatPairKey enum, interfaces, TranslatorRegistry
+-- registry.ts                           <- Builtin pair registration (3 pairs)
+-- type-guards.ts                        <- asRecord, asRecordArray, asRecordOptional
+-- request/
|   +-- anthropic-to-openai.ts            <- Anthropic -> OpenAI request
|   +-- openai-to-anthropic.ts            <- OpenAI -> Anthropic request
|   +-- responses-to-chat-completions.ts  <- Responses -> Chat Completions request
|   +-- responses-helpers.ts              <- Shared: extractTextContent, translateUserContent, extractToolCalls
+-- response/
|   +-- anthropic-to-openai.ts            <- Anthropic -> OpenAI response
|   +-- openai-to-anthropic.ts            <- OpenAI -> Anthropic response
|   +-- chat-completions-to-responses.ts  <- Chat Completions -> Responses response
+-- stream/
    +-- anthropic-to-openai.ts            <- Anthropic SSE -> OpenAI SSE
    +-- openai-to-anthropic.ts            <- OpenAI SSE -> Anthropic SSE
    +-- chat-completions-to-responses.ts  <- Chat Completions SSE -> Responses SSE
    +-- sse-parser.ts                      <- parseSseFrame, parseSseBuffer
    +-- sse-encoder.ts                     <- createSseEncoder (event-type SSE)
    +-- finish-reason.ts                   <- mapFinishReason (OpenAI -> Anthropic)
```
