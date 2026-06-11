# Design System: opencode-cowork-proxy

> Bidirectional AI API translation gateway -- Anthropic <-> OpenAI format bridge.
> This document describes translation patterns, data flow design, error handling, model routing, and extensibility points.

## 1. API Translation Patterns

### 1.1 Translation Layer Architecture

All translation functions live in `src/translate/` and are **pure functions** -- no `fetch()`, no `fs.*`, no I/O. They accept `Record<string, unknown>` and return `Record<string, unknown>`. Stream translators accept `ReadableStream` and return `ReadableStream`.

Three categories of translation:

| Category | Count | Pattern |
|----------|-------|---------|
| Request translators | 3 | `format[From]To[To](body) -> translatedBody` |
| Response translators | 3 | `to[Format]Response(body) -> translatedBody` or `format[From]To[To](body) -> translatedBody` |
| Stream translators | 3 | `stream[From]To[To](readableStream) -> readableStream` |

### 1.2 Dual-Path Design Per Handler

Each POST handler supports two paths controlled by the `X-Upstream-Format` header:

- **Translation path** (default for forward conversion): Parse JSON body, apply model overrides, convert format, send to upstream, convert response back.
- **Pass-through path** (default for same-format): Send raw body to upstream with minimal modification. Includes a **fast path** that avoids JSON parsing entirely when no model override or image markers are detected via `rawBodyMayHaveImages()` -- a lightweight string scan.

### 1.3 Data Flow

```
Client Request
  |
  v
index.ts (Hono app) -- CORS, body size gate, route dispatch
  |
  v
Handler -- authenticate, parse body, apply model overrides
  |  \
  |   +--> Pass-through fast path: send raw body string verbatim
  |   +--> Pass-through slow path: parse, override model/images, re-serialize
  |   +--> Translation path: format body, send, format response
  |
  v
Upstream API (opencode.ai/zen/go or /zen)
```

## 2. Error Handling Design

### 2.1 Authentication Errors

- Missing API key: HTTP 401, body `{error: {type: "authentication_error", message: "..."}}`
- Key too short (under 32 chars): HTTP 401
- Response format varies by path: Anthropic format (`{type: "error", error: {...}}`) for `/v1/messages` and `/v1/models`; OpenAI format for other paths.

### 2.2 Request Validation Errors

- Invalid JSON body: HTTP 400, `{error: {type: "invalid_request_error", message: "Invalid JSON body"}}`
- Oversized body (over 10 MB): HTTP 413
- Unknown path: HTTP 404

### 2.3 Upstream Error Relay

Errors from the upstream API are forwarded to the client with the original status code, response body, and headers (Content-Type, Retry-After, upstream rate-limit headers). The `upstreamErrorResponse()` function preserves the upstream's error format.

### 2.4 Think Tag Stripping

Some upstream models (minimax-m3-free) embed reasoning content as `<think>...</think>` tags in text content. This is handled by `src/think-tag-stripper.ts`:

- **Non-streaming**: Regex `/<think>[\s\S]*?<\/think>/g` -- applied in the Responses API response translator.
- **Streaming**: Stateful `ThinkTagStripper` class that tracks open/close tag boundaries across SSE chunks. Returns `null` for chunks fully consumed by think tags.

Applied to Responses API responses only (both streaming and non-streaming paths).

## 3. Model Routing Design

### 3.1 URL-Based Routing (No Hono Router)

Routing uses explicit `new URL(request.url).pathname` parsing with custom prefix stripping. Hono's `app.all('*')` catches all paths with a single handler. This allows flexible model override from URL path without configuring Hono routes per model model.

### 3.2 Path Prefix Routing

| Prefix | Upstream | Example |
|--------|----------|---------|
| `/go/...` | `https://opencode.ai/zen/go` | `/go/v1/messages` |
| `/zen/...` | `https://opencode.ai/zen` | `/zen/v1/chat/completions` |
| `/<model>/...` | Default upstream | `/claude-sonnet-4/v1/messages` |
| No prefix | Default upstream (Go) | `/v1/responses` |

### 3.3 Model Override Chain Order (Critical)

1. **URL segment override** -- Explicit user intent, highest priority. e.g., `/claude-sonnet-4/v1/messages` overrides model to `claude-sonnet-4`.
2. **Vision model override** -- If images detected in the request, model switches to a vision-capable model.
3. **DeepSeek thinking injection** (Responses API only) -- Auto-injects `thinking: {type: "enabled"}` for `deepseek-*` models. Runs AFTER vision override to prevent injecting thinking on a non-DeepSeek model forced by image detection.

### 3.4 Upstream Override

The `X-Upstream-Url` header can override the upstream URL entirely. Header-based override takes precedence over URL prefix routing.

## 4. Extensibility Points

### 4.1 Adding a New Translation Direction

1. Create request/response/stream translators in `src/translate/request/`, `src/translate/response/`, `src/translate/stream/`.
2. Export from `src/translate/index.ts` (must remain a pure barrel file).
3. Create a handler in `src/handlers/` following the existing pattern `handle[Endpoint]()`.
4. Add route dispatch in `src/index.ts`.
5. Add type-guard helpers to `src/translate/type-guards.ts` if needed.

### 4.2 Adding a New Upstream Provider

1. Add upstream URL constant to `src/config.ts`.
2. Add vision model set (`VISION_CAPABLE_*`) to `src/config.ts`.
3. Add prefix routing in `src/routing.ts` if URL-based selection is needed.

### 4.3 Adding a New Vision Model

Add the model ID to both `VISION_CAPABLE_GO` and `VISION_CAPABLE_ZEN` sets in `src/config.ts`. Verify against upstream catalogs (see config.ts docstring).

### 4.4 Adding a New Header-Based Feature

Headers like `X-Upstream-Format`, `X-Upstream-Url`, `X-Api-Key` are processed at specific points. Add new headers to the CORS allow list in `src/index.ts` if they need browser support.

## 5. Design Constraints

- **File size cap**: 500 lines per source file (enforced by architecture tests).
- **Import cap**: 10 imports per file.
- **Translation purity**: No I/O in translate layer.
- **Type safety**: Use `type-guards.ts` helpers (`asRecord`, `asRecordArray`, `asRecordOptional`) instead of bare `as` casts. No `any`. Max 3 non-null assertions per file.
