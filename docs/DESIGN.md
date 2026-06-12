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


## 6. Response Caching Design

### 6.1 Cache Architecture

The proxy has two caching layers:

| Layer | Scope | Storage | TTL | Capacity |
|-------|-------|---------|-----|----------|
| Cloudflare Cache API | Model lists only | CF edge cache | 300s | Unlimited |
| In-memory LRU | All deterministic endpoints | `Map<string, CacheEntry>` | Configurable (default 60s) | 50 entries |

### 6.2 In-Memory Cache

`src/response-cache.ts` implements a write-through in-memory cache:

- **Cache key**: `upstream|path|bodyHash` (body hash via `simpleHash()` — 32-bit djb2 variant)
- **Eviction**: LRU-like (oldest creation time removed first when at capacity)
- **Cache policy**: Only 2xx non-streaming responses; error responses and SSE are never cached
- **Header injection**: Cached responses include `X-Cache: hit` / `X-Cache: miss`
- **Cleanup**: Periodic timer every 30s removes expired entries; timer auto-stops when empty

### 6.3 Limitations

- Per-isolate cache — no coordination across Cloudflare Workers isolates
- Body hash is a simple hash, not a cryptographic digest — collision risk is non-zero but acceptable for deduplication

## 7. Rate-Limit Awareness Design

### 7.1 Architecture

`src/rate-limit.ts` provides advisory-only rate-limit tracking (not enforcement). The upstream is the authority on rate limits.

```
Upstream Response
  ↓
safeUpstreamFetch() → trackRateLimits(url, res)
  ↓
State Map (per upstream)
  ↓
getRateLimitState() | isUpstreamThrottled() | recommendThrottleDelay()
```

### 7.2 Tracked Headers

- `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` — standard IETF rate-limit headers
- `X-RateLimit-Limit-Requests`, `X-RateLimit-Limit-Tokens` — OpenCode-specific headers

### 7.3 Throttle Logic

| Condition | Action |
|-----------|--------|
| Remaining < 5 | `log.warn()` with reset time |
| Remaining = 0, window not expired | `isUpstreamThrottled()` returns true |
| Remaining/Limit < 20% | `recommendThrottleDelay()` returns per-request delay (capped at 5s) |

### 7.4 Design Decisions

- **Advisory only**: The proxy never blocks requests based on rate-limit data. Blocking is the upstream's responsibility.
- **No persisted state**: Rate-limit state is in-memory only, lost on process restart.

## 8. Request Body Validation Design

### 8.1 Architecture

`src/validate.ts` uses Zod v4 schemas to validate request bodies at the handler boundary, BEFORE translation logic executes.

```
Client Request Body
  ↓
Handler → validateBody(body, schema)
  ↓                    ↓
  success           failure
  ↓                    ↓
  translate()     400 Response + error details
```

### 8.2 Schema Design Principles

- **Lenient by default**: Zod v4 strips unknown keys. New API fields won't break existing clients.
- **Type narrowing**: Validation output is fully typed (`z.infer<typeof schema>`).
- **Granular error reporting**: Each validation failure includes path, message, and error code.
- **Separate schemas per endpoint**: Three schemas for three API formats.

### 8.3 Schemas

| Schema | Validates | Used By |
|--------|-----------|---------|
| `anthropicMessagesSchema` | POST /v1/messages | Anthropic clients |
| `openAIChatSchema` | POST /v1/chat/completions | OpenAI SDK clients |
| `responsesAPISchema` | POST /v1/responses | Responses API clients |

## 9. Audit Logging Design

### 9.1 Architecture

All audit events flow through the unified logger (`log.audit()`) AND are buffered in an in-memory ring buffer for the `/audit/log` endpoint.

```
Security Event
  ↓
auditAuth() / auditError() / auditModelOverride() / auditUpstreamSwitch() / auditStream()
  ↓
recordAudit(type, action, details)
  ↓                           ↓
log.audit(pfx, msg, details)  bufferEvent(event) → Ring Buffer (1000)
  ↓
JSON stdout
```

### 9.2 Event Types

| Type | Prefix | Events |
|------|--------|--------|
| auth | AUTH | authenticated, auth_failed |
| upstream | UPSTREAM | switch |
| model | MODEL | override_url, override_vision, override_thinking |
| error | ERROR | unhandled_exception, upstream_failure |
| stream | STREAM | ws_upgrade, start, end, abort |
| proxy | PROXY | startup |

## 10. Plugin Translator Architecture

### 10.1 Interfaces

`src/translate/plugin.ts` defines three translator interfaces and a `FormatPair` aggregator:

```
RequestTranslator<TBody>    translate(body, model?) → Record
ResponseTranslator           translate(body, model) → Record
StreamTranslator             translate(stream, model) → ReadableStream
```

A `FormatPair` bundles all three for one translation direction:

```typescript
interface FormatPair {
  key: FormatPairKey;
  label: string;
  request: RequestTranslator;
  response: ResponseTranslator;
  stream: StreamTranslator;
}
```

### 10.2 Registration

```typescript
import { translatorRegistry, FormatPairKey } from './translate/plugin';
import { ensureTranslatorsRegistered } from './translate/registry';

// Auto-register built-in pairs at startup
ensureTranslatorsRegistered();

// Register a custom pair
translatorRegistry.register(myCustomPair);

// Look up at runtime
const pair = translatorRegistry.get(FormatPairKey.AnthropicToOpenAI);
```

### 10.3 Registered Pairs

| Key | Direction | Files |
|-----|-----------|-------|
| `AnthropicToOpenAI` | Anthropic Messages ↔ OpenAI Chat | `request/anthropic-to-openai`, `response/anthropic-to-openai`, `stream/*` |
| `OpenAIToAnthropic` | OpenAI Chat ↔ Anthropic Messages | `request/openai-to-anthropic`, `response/openai-to-anthropic`, `stream/*` |
| `ResponsesToChat` | Responses API ↔ Chat Completions | `request/responses-to-chat`, `response/chat-completions-to-responses`, `stream/*` |

## 11. Unified Logging Design

### 11.1 Output Format

Every log line across the entire proxy follows this schema:

```json
{
  "level": "INFO",
  "ts": "2026-06-12T07:56:17.346Z",
  "pfx": "HTTP",
  "msg": "POST /v1/messages 200 1384ms",
  "details": { "method": "POST", "path": "/v1/messages", "status": 200, "durationMs": 1384 }
}
```

### 11.2 Levels

| Level | Priority | Gated | Use Cases |
|-------|----------|-------|-----------|
| DEBUG | 0 | `IS_DEBUG` env var | Translation debugging, retry details |
| AUDIT | 1 | Always on | Security events (auth, upstream, errors) |
| INFO | 1 | Always on | Access logs, startup, operational info |
| WARN | 2 | Always on | Low quota, think tag detection, cache failures |
| ERROR | 3 | Always on | Upstream errors, unhandled exceptions |

### 11.3 PREFIX Convention

| Prefix | Source | When |
|--------|--------|------|
| HTTP | build-entry.ts | Every HTTP request |
| STARTUP | index.ts | Module initialization |
| AUTH | audit.ts | Authentication events |
| STREAM | audit.ts, stream translators | Stream lifecycle |
| RETRY | request.ts | Upstream retry attempts |
| RATELIMIT | rate-limit.ts | Low quota warnings |
| RESPONSES | handlers/responses.ts | Responses API debug |
| MODELS | handlers/models.ts | Model list operations |
| COMPRESS | compress.ts | Compression events |
