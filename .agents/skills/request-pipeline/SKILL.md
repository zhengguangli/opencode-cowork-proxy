---
name: request-pipeline
description: "Request pipeline, auth, body gate, routing, translation, upstream fetch, response, compression, audit. Triggers on: \"request flow\", \"请求处理\", \"auth\", \"audit\", \"pipeline\". Do NOT trigger for general request discussion."
capabilities:
  - pipeline
  - auth
  - audit
  - security
---

# Request Pipeline

## Full Request Lifecycle

```
Client Request
    ↓
1. CORS middleware (src/index.ts)
    ↓
2. Request ID injection (src/logger.ts)
    ↓
3. WebSocket check → 426 (src/index.ts)
    ↓
4. Route resolution (src/routing.ts)
    ↓
5. Body size gate (src/request.ts)
    ↓
6. Auth extraction (src/auth.ts)
    ↓
7. Handler dispatch (src/handlers/index.ts)
    ↓
8. Translation (src/translate/plugin.ts) or pass-through
    ↓
9. Upstream fetch with retry (src/request.ts)
    ↓
10. Response translation or pass-through
    ↓
11. Compression (src/compress.ts, src/request.ts)
    ↓
12. Metrics recording (src/handlers/metrics.ts)
    ↓
13. Audit logging (src/audit.ts)
    ↓
14. Rate-limit tracking (src/rate-limit.ts)
    ↓
15. Response cache (src/response-cache.ts)
    ↓
Client Response
```

---

## 1. CORS Middleware

**File:** `src/index.ts`

```typescript
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key, Authorization, X-Upstream-Url, X-Upstream-Format, Anthropic-Version, Anthropic-Beta');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});
```

Allowed custom headers: `X-Api-Key`, `Authorization`, `X-Upstream-Url`, `X-Upstream-Format`, `Anthropic-Version`, `Anthropic-Beta`.

## 2. Request ID Injection

**File:** `src/logger.ts`

```typescript
withRequestId(generateId(), () => handleRequest(c.req.raw))
```

- `generateId()` produces `Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4)`
- Module-level variable `currentRequestId` — CF Workers safe (single-request-per-isolate)
- All log lines include `req` field for correlation

## 3. WebSocket Check

**File:** `src/index.ts`

Paths starting with `/ws/` are intercepted before routing. Returns 426 Upgrade Required if WebSocket upgrade fails.

**Handler:** `handleWebSocketUpgrade` in `src/handlers/websocket.ts`

## 4. Route Resolution

**File:** `src/routing.ts`

```typescript
routeConfig(request: Request): RouteConfig
```

Returns `{ path, upstream, modelOverride }`:
- `/go/...` → GO_UPSTREAM
- `/zen/...` → ZEN_UPSTREAM
- Default → DEFAULT_UPSTREAM (go)
- Model override extracted from first path segment (e.g. `/zen/mimo-v2.5-free/v1/messages`)

```typescript
getUpstream(request, routeUpstream): string
upstreamFormat(request): "openai" | "anthropic"
```

- `X-Upstream-Url` header overrides `routeUpstream` (URL-validated)
- `X-Upstream-Format` header selects translation format (default: `openai`)

## 5. Body Size Gate

**File:** `src/request.ts`

```typescript
checkBodySize(request: Request): Promise<Response | null>
```

- Max: 10 MB (`MAX_BODY_SIZE` in `src/config.ts`)
- Fast path: checks `Content-Length` header (no body read)
- Fallback: clones request, reads `arrayBuffer()` (preserves original for downstream)
- Returns 413 if exceeded, null if OK
- Only applies to POST requests (checked in `src/index.ts`)

## 6. Auth Extraction

**File:** `src/auth.ts`

```typescript
extractApiKey(headers): string | null
```

Priority order:
1. `X-Api-Key` header
2. `Authorization: Bearer <key>` / `Authorization: Token <key>`

```typescript
validateApiKey(key: string | null): AuthError | null
```

Validation rules:
- Missing → 401 "Missing API key"
- `< 32 chars` → 401 "must be at least 32 characters"
- Invalid chars (not `[A-Za-z0-9_-]`) → 401 "invalid characters"

```typescript
identifyKeyType(key: string): string
```

| Pattern | Type |
|---------|------|
| `sk-ant-*` (40+ chars) | `anthropic` |
| `sk-*` / `pk-*` (29+ trailing) | `opencode` |
| 40+ chars | `generic-long` |
| other | `generic` |

```typescript
authenticateRequest(request, path): { key } | { response }
```

Combines extraction + validation. Returns auth error response for `/v1/messages` and `/v1/models` in Anthropic error format.

## 7. Handler Dispatch

**File:** `src/handlers/index.ts` — 9 handlers

| Handler | Route | Method |
|---------|-------|--------|
| `handleAnthropicToOpenAI` | `/v1/messages` | POST |
| `handleOpenAIChatCompletions` | `/v1/chat/completions` | POST |
| `handleResponsesAPI` | `/v1/responses` | POST |
| `handleModelList` | `/v1/models` | GET |
| `handleHealthCheck` | `/` | GET |
| `handleMetrics` | `/metrics` | GET |
| `handleUpstreamHealth` | `/health/upstream` | GET |
| `handleAuditLog` | `/audit/log` | GET |
| `handleWebSocketUpgrade` | `/ws/*` | WS |

Auth-free endpoints: `/metrics`, `/health/upstream`, `/audit/log`, `/` (health).

## 8. Translation

**File:** `src/translate/plugin.ts`

```typescript
enum FormatPairKey {
  AnthropicToOpenAI = 'anthropic-to-openai',
  OpenAIToAnthropic = 'openai-to-anthropic',
  ResponsesToChat = 'responses-to-chat',
}
```

Each `FormatPair` contains:
- `request: RequestTranslator` — translate request body
- `response: ResponseTranslator` — translate response body
- `stream: StreamTranslator` — translate SSE stream

Handler selects translator based on `upstreamFormat()`:
- `"anthropic"` → use `AnthropicToOpenAI` pair (client sends Anthropic, upstream expects OpenAI)
- `"openai"` → pass-through or use `OpenAIToAnthropic` pair

## 9. Upstream Fetch

**File:** `src/request.ts`

```typescript
safeUpstreamFetch(url: string, init: RequestInit): Promise<Response>
```

Retry behavior:
- Max retries: 2 (`MAX_RETRIES` in `src/config.ts`)
- Retry delay: `500 * 2^attempt` ms + random jitter (0-200ms), capped at 10s
- Retries on: 5xx server errors, network failures
- **No retries** for streaming requests (detects `stream: true` in body)
- Aborted requests return 499

## 10. Response

Translation back via response translator, or pass-through if format matches.

Error relay via `upstreamErrorResponse()` — preserves `Content-Type`, `Retry-After`, and rate-limit headers.

## 11. Compression

**File:** `src/compress.ts`

- `compressibleStream(stream, request)` — wraps SSE streams with `CompressionStream('gzip')`
- `jsonResponse(request, data, headers)` — gzip for JSON responses > 1024 bytes
- Checks `Accept-Encoding: gzip`
- Sets `Content-Encoding: gzip` and `Vary: Accept-Encoding`

## 12. Metrics Recording

**File:** `src/handlers/metrics.ts`

```typescript
recordRequest(method, path, status, durationMs): void
recordUpstreamRequest(upstream): void
recordUpstreamError(upstream, status): void
incrementActiveStreams() / decrementActiveStreams(): void
```

6 Prometheus metrics at `GET /metrics`:
- `uptime_seconds` — gauge
- `active_streams` — gauge
- `http_requests_total` — counter by method/path/status
- `http_request_duration_ms` — histogram (buckets: 5, 10, 25, 50, 100, 250, 500, 1000, 3000, 10000)
- `upstream_requests_total` — counter by upstream
- `upstream_errors_total` — counter by upstream/status

## 13. Audit Logging

**File:** `src/audit.ts`

6 event types:

| Type | Prefix | Purpose |
|------|--------|---------|
| `auth` | AUTH | Auth success/failure |
| `upstream` | UPSTREAM | Upstream URL switches |
| `model` | MODEL | Model overrides |
| `error` | ERROR | Upstream errors |
| `stream` | STREAM | Stream start/end/abort |
| `proxy` | PROXY | Startup, config |

Ring buffer: 1000 events max, accessible at `GET /audit/log` (200 most recent).

Typed helpers: `auditAuth()`, `auditUpstreamSwitch()`, `auditModelOverride()`, `auditError()`, `auditStream()`.

All audit events log at `AUDIT` level (always on, not gated by `IS_DEBUG`).

## 14. Rate-Limit Tracking

**File:** `src/rate-limit.ts`

Tracks upstream `RateLimit-*` headers per upstream URL:
- `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`
- `X-RateLimit-Limit-Requests`, `X-RateLimit-Limit-Tokens`

```typescript
trackRateLimits(upstream, response): Record<string, string>
getRateLimitState(upstream): RateLimitState | null
isUpstreamThrottled(upstream): boolean
recommendThrottleDelay(upstream): number
```

- Warns when remaining < 5
- `isUpstreamThrottled()` returns true if remaining ≤ 0 and before reset window
- `recommendThrottleDelay()` suggests backoff in last 20% of quota (capped at 5s)
- Headers forwarded to client via `forwardUpstreamHeaders()` in `src/request.ts`

## 15. Response Cache

**File:** `src/response-cache.ts`

In-memory LRU cache for non-streaming responses:
- Cache key: `hash(upstream + path + body)`
- Default TTL: 60s (`DEFAULT_TTL_MS`)
- Max entries: 50 (`MAX_CACHE_SIZE`)
- Only caches 2xx responses, not `text/event-stream`
- Cleanup interval: 30s
- Model list responses also cached via Cloudflare Cache API (300s TTL in `src/config.ts` `MODEL_CACHE_TTL`)

```typescript
getCachedResponse(upstream, path, body): Response | null
setCachedResponse(upstream, path, body, response, ttlMs?): Promise<void>
getCacheStats(): { size, entries }
clearCache(pattern?): number
```

## Request Validation

**File:** `src/validate.ts`

Zod v4 schemas for 3 API formats:

| Schema | Route |
|--------|-------|
| `anthropicMessagesSchema` | `/v1/messages` |
| `openAIChatSchema` | `/v1/chat/completions` |
| `responsesAPISchema` | `/v1/responses` |

Schemas are lenient by default (strip unknown keys). `validateBody()` returns typed data or 400 Response.

## Pipeline Flow in index.ts

```
for each request:
  withRequestId(generateId()) {
    if /ws/* → handleWebSocketUpgrade
    routeConfig(request) → route
    getUpstream(request, route.upstream) → upstream
    upstreamFormat(request) → fmt
    if POST → checkBodySize (413 if >10MB)
    dispatch to handler by route.path + method
    recordRequest() + log.access()
  }
```

Metrics, audit, and rate-limit tracking are called within handlers as side-effects.