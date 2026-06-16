---
name: api-translation
description: 'Anthropic↔OpenAI API format translation. Format mapping, stream patterns, vision routing, edge cases for the API translation gateway. Triggers on: "translation issue", "format conversion", "API bridge", "Anthropic OpenAI mapping". Do NOT trigger for general API design discussion.'
---

# API Translation — Format Bridge Knowledge

## Core Architecture

This project is an API translation gateway between Anthropic and OpenAI formats. See `docs/ARCHITECTURE.md` for the full layer map.

### Translation Layer — Pure Functions

All translation functions live in `src/translate/` and are **pure** — no `fetch()`, no `fs.*`, no I/O.

```
src/translate/
├── plugin.ts              ← FormatPair interface definitions
├── registry.ts            ← Format pair registration
├── index.ts               ← Barrel export of all 9 translators
├── type-guards.ts         ← Safe type narrowing helpers (asRecord, asRecordArray)
├── request/               ← 3 request translators
│   ├── anthropic-to-openai.ts
│   ├── openai-to-anthropic.ts
│   └── responses-to-chat-completions.ts
├── response/              ← 3 response translators
│   ├── anthropic-to-openai.ts
│   ├── openai-to-anthropic.ts
│   └── chat-completions-to-responses.ts
└── stream/                ← 3 stream translators + utilities
    ├── anthropic-to-openai.ts
    ├── openai-to-anthropic.ts
    ├── chat-completions-to-responses.ts
    ├── finish-reason.ts
    ├── sse-encoder.ts
    └── sse-parser.ts
```

## Format Pairs

Three registered format pairs (see `src/translate/registry.ts`):

| Pair Key | Request | Response | Stream | Direction |
|----------|---------|----------|--------|-----------|
| AnthropicToOpenAI | Anthropic Messages → OpenAI Chat | OpenAI Chat → Anthropic Messages | OpenAI SSE → Anthropic SSE | Bidirectional |
| OpenAIToAnthropic | OpenAI Chat → Anthropic Messages | Anthropic Messages → OpenAI Chat | Anthropic SSE → OpenAI SSE | Bidirectional |
| ResponsesToChat | OpenAI Responses → Chat Completions | Chat Completions → OpenAI Responses | Chat SSE → Responses SSE | One-way |

## Dual-Path Handler Design

Each POST handler has two paths, controlled by `X-Upstream-Format` header:

| Endpoint | Default Path | Alt Path |
|----------|-------------|----------|
| `POST /v1/messages` | Translate Anthropic→OpenAI (X-Upstream-Format: openai) | Pass-through (if X-Upstream-Format: anthropic) |
| `POST /v1/chat/completions` | Pass-through (X-Upstream-Format: openai) | Translate OpenAI→Anthropic (if anthropic) |
| `POST /v1/responses` | Translate Responses→Chat Completions (if X-Upstream-Format: openai) | Raw pass-through |

### Fast Path

When no model override or image markers are detected, the pass-through path uses `rawBodyMayHaveImages()` — a lightweight string scan that avoids JSON parsing entirely. See `src/handlers/shared.ts`.

## Vision / Image Routing

When Claude sends an image in a request, the proxy automatically:
1. Detects image content blocks in the Anthropic request
2. Overrides the model to **Qwen3.6 Plus** (`qwen3.6-plus`)
3. Translates image blocks to OpenAI image content parts
4. Routes to the vision-capable model

See `src/vision.ts` for the image detection + model override logic.

## Known Edge Cases

| Issue | Location | Behavior |
|-------|----------|----------|
| Think tags (`...`) | `src/think-tag-stripper.ts` | Stripped from text content before forwarding |
| Tool/function calling | Request translators | Mapped between Anthropic `tool_use` / `tool_result` and OpenAI `tool_calls` / `tool` |
| Streaming finish reason | `src/translate/stream/finish-reason.ts` | Map between `end_turn` / `stop` / `tool_use` and `stop` / `length` / `tool_calls` |
| Model override | `src/handlers/shared.ts` | Applied before translation; `OPENAI_MODEL_OVERRIDE` / `ANTHROPIC_MODEL_OVERRIDE` env vars |
| Body size gate | `src/request.ts` | All POST requests pass through `checkBodySize()` before any processing |

## Adding a New Format Pair

1. Create request/response/stream translator functions in `src/translate/`
2. Add a new `FormatPairKey` enum value in `src/translate/plugin.ts`
3. Create `FormatPair` adapters in `src/translate/registry.ts`
4. Call `translatorRegistry.register(newPair)` in `registerBuiltinTranslators()`
5. Wire the new pair into the relevant handler(s) via `resolveByPrefix()` in `src/providers.ts`

## Testing Translation

| Test File | Coverage |
|-----------|----------|
| `test/openai-to-anthropic-request.test.ts` | OpenAI → Anthropic request translation |
| `test/anthropic-to-openai-request.test.ts` | Anthropic → OpenAI request translation |
| `test/responses-request.test.ts` | Responses API request translation |
| `test/responses-response.test.ts` | Responses API response translation |
| `test/responses-stream.test.ts` | Streaming response translation |
| `test/response.test.ts` | General response translation |
| `test/stream.test.ts` | Stream translation utilities |
| `test/think-tag-stripper.test.ts` | Think tag handling |
| `test/vision.test.ts` | Image/vision routing |
| `test/plugin.test.ts` | Plugin registration system |
