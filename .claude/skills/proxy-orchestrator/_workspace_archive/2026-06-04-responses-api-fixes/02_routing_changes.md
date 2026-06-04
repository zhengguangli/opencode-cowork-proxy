# Routing Layer Fixes — Changes Summary

**Date:** 2026-06-04
**Based on diagnosis:** `01_routing_diagnosis.md`

---

## 1. `src/index.ts`

### CRITICAL

| ID | Change | Description |
|----|--------|-------------|
| C1 | Added `safeJsonBody<T>()` helper | Wraps all 6 `request.json()` calls in try-catch. Returns 400 `invalid_request_error` on malformed body. Eliminates unhandled rejections from malformed JSON. |
| C2 | Added `safeUpstreamFetch()` helper | Wraps all 8 `fetch()` calls in try-catch. Returns 502 `upstream_error` on network failure (DNS, timeout, TLS). Eliminates unhandled rejections from unreachable upstream. |
| C3 | Added auth to `/` root endpoint | Unauthenticated root requests return `{ status: "ok" }` (no topology leak). Authenticated requests return full route map. |

### HIGH

| ID | Change | Description |
|----|--------|-------------|
| H1+H2 | Added `forwardUpstreamHeaders()` | All 6 streaming and 6 non-streaming translated response paths now forward `X-Request-Id`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` from upstream response headers. |
| H3 | Added `!res.ok` check to pass-through paths | Both `/v1/messages` pass-through and `/v1/chat/completions` pass-through now call `upstreamErrorResponse()` when upstream returns a non-2xx status. Previously these were returned raw. |
| H4 | Added clarifying comments | Each image-detection call site now has a comment stating which body format it expects (Anthropic: `type: "image"`, OpenAI: `type: "image_url"`, Responses: `type: "input_image"`). |

### MEDIUM

| ID | Change | Description |
|----|--------|-------------|
| M1 | Reordered `/v1/responses` handler | Vision model override (`hasResponsesImages` → `VISION_MODEL`) now runs BEFORE DeepSeek thinking injection. Prevents injecting `thinking` block when model is overridden to `qwen3.6-plus`. |
| M2 | Added `authenticateRequest()` helper | Returns a discriminated union `{ key: string } | { response: Response }`. All handlers use this, eliminating the `key!` non-null assertions and providing type-safe `key` after auth. The extra `if (!key)` check covers the theoretical gap. |

### LOW

| ID | Change | Description |
|----|--------|-------------|
| L2 | Updated `getUpstream()` | Added `.trim()` to `X-Upstream-Url` header value. Added URL validation via `new URL()` try-catch; invalid URLs fall through to configured upstream. |
| L4 | Replaced `API_START_PATHS` Set | Now uses `API_VERSION_PATTERN = /^v\d+$/` regex. Detects any `v<N>` prefix as an API version (v3, v4, etc.) instead of a hardcoded `['v1', 'v2']` set. |

---

## 2. `src/auth.ts`

| ID | Change | Description |
|----|--------|-------------|
| L1 | Fixed `extractApiKey` Record lookup | Previously only looked up with `name.toLowerCase()` — failed on mixed-case keys in `Record` objects. Now tries `record[name]` first, falls back to `record[name.toLowerCase()]`. `Headers` objects (production) were already case-insensitive and unaffected. |

---

## 3. `src/cache.ts`

| ID | Change | Description |
|----|--------|-------------|
| M3 | Clarified JSDoc | `extractUncachedInputTokens` now documents that it assumes OpenAI-style usage (cached tokens bundled inside `prompt_tokens`). Warns not to call with pure Anthropic-style usage where tokens are separate counts. |
| L3 | Added Responses API input support | `hasCacheControl()` now takes optional `body` parameter and checks `body.input` for `cache_control` markers in Responses API format. Backward compatible — no callers pass the third argument today. |

---

## Test Results

```
✓ 7 test files passed
✓ 138 tests passed
```
No regressions introduced.
