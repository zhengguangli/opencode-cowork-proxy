# Security: opencode-cowork-proxy

> API key validation, request/response integrity, rate limiting considerations, dependency vulnerability management, and no-data-persistence design.

## 1. API Key Validation

### 1.1 Key Extraction

Keys are extracted from two header sources (checked in order):
1. `X-Api-Key` header (preferred)
2. `Authorization: Bearer <key>` or `Authorization: Token <key>` header (fallback)

### 1.2 Key Validation

- Minimum length check: 32 characters.
- No specific key format beyond length.
- The proxy does not generate or manage API keys -- it only validates them before forwarding to upstream.
- The 32-char minimum prevents accidental empty or obviously invalid keys from wasting upstream calls.

### 1.3 Auth Flow

Authentication happens in `src/request.ts` via `authenticateRequest()`, which combines extraction and validation. On failure, returns an HTTP 401 response with format-aware error body (Anthropic format for `/v1/messages` paths, OpenAI format otherwise).

**All POST endpoints require authentication.** The health check endpoint (`GET /`) does not.

## 2. Request/Response Integrity

### 2.1 Body Size Gate

All POST requests pass through `checkBodySize()` before any processing:
- Fast path: Uses `Content-Length` header when present (no body read).
- Fallback: Reads body via `request.clone()` to preserve original body for downstream consumers.
- Threshold: 10 MB (`MAX_BODY_SIZE` in config.ts).

### 2.2 Gzip Compression

Responses are gzip-compressed when the client sends `Accept-Encoding: gzip` and the response body exceeds 1 KB. Compression is applied in `jsonResponse()`.

### 2.3 Upstream Forwarded Headers

Rate-limit and request-tracking headers are forwarded from upstream responses to clients:
- `X-Request-Id`
- `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`
- `X-RateLimit-Limit-Requests`, `X-RateLimit-Limit-Tokens`

### 2.4 JSON Body Parsing Safety

All JSON parsing uses `safeJsonBody()` which wraps `request.json()` in try/catch and returns a 400 error for malformed bodies. The translate layer uses `type-guards.ts` helpers (`asRecord`, `asRecordArray`, `asRecordOptional`) for safe runtime type narrowing rather than bare `as` casts.

## 3. No Data Persistence Design

The proxy is **stateless by design**:

- No database connections.
- No file system writes.
- No in-memory request state across invocations.
- The only cache is the Cloudflare Cache API for model list responses (300s TTL, URL-based cache key, auth-independent).

This eliminates data breach surface area for stored data.

## 4. Rate Limiting Considerations

Rate limiting is handled by the **upstream provider** (opencode.ai/zen), not by this proxy. The proxy:
- Forwards upstream rate-limit headers to the client for visibility.
- Has no built-in rate limiting -- the Cloudflare Workers plan provides basic network-level protection.
- Uses exponential backoff with jitter for retryable upstream errors (5xx, network failures), max 2 retries.

## 5. Dependency Vulnerability Management

### 5.1 Minimal Dependency Surface

The project has a single runtime dependency: **Hono** (HTTP framework, v4.12.17).

All other dependencies are dev-only: TypeScript, Vitest, `@types/node`.

### 5.2 Supply Chain Risk

- `package.json` is the sole dependency source -- no lockfiles committed.
- Hono is a well-audited framework with minimal surface area (routing + CORS).
- The Bun standalone binary bundles all dependencies at compile time via `bun build --compile`.

### 5.3 Runtime Versions

Three deployment targets with different runtime environments:
- **Cloudflare Workers**: Workers runtime (V8 isolates), controlled by `compatibility_date`.
- **Bun standalone**: Bun runtime, compiled binary, no runtime dependency resolution.
- **Vercel**: Node.js/Edge runtime as configured by Vercel.

## 6. CORS Configuration

CORS allows all origins (`*`) for GET, POST, OPTIONS methods. Allowed headers include X-Api-Key, Authorization, X-Upstream-Url, X-Upstream-Format, Anthropic-Version, Anthropic-Beta. Preflight (OPTIONS) returns 204 with no body.
