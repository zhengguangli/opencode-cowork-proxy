# Routing Module Bug Diagnosis Report

**Reviewed files:** `src/index.ts`, `src/auth.ts`, `src/cache.ts`
**Date:** 2026-06-04
**Reviewer:** Routing Specialist

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 3 |
| HIGH     | 4 |
| MEDIUM   | 3 |
| LOW      | 5 |
| **Total** | **15** |

---

## CRITICAL

### C1. Missing try-catch for `request.json()` — malformed body causes unhandled rejection

- **File:** `/Users/lizhengguang/Documents/Github/opencode-cowork-proxy/src/index.ts`
- **Lines:** 128, 156, 175, 199, 216
- **Description:** All POST handlers call `await request.json()` without a try-catch. If a client sends a malformed JSON body (e.g., truncated, invalid syntax, or a very large payload that triggers OOM), the proxy crashes with an unhandled promise rejection. This affects all four route paths: `/v1/messages`, `/v1/chat/completions`, `/v1/responses`, and any body-consuming handler.
- **Suggested fix:** Wrap each `request.json()` call in a try-catch, or use a shared helper. Return a standardized 400 error with a descriptive message:
  ```ts
  let body: any;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: { type: "invalid_request_error", message: "Invalid JSON body" } }), { status: 400, headers: { "Content-Type": "application/json" } }); }
  ```

### C2. Missing try-catch for `fetch()` — upstream network failures cause unhandled rejection

- **File:** `/Users/lizhengguang/Documents/Github/opencode-cowork-proxy/src/index.ts`
- **Lines:** 135, 159, 180, 202, 231, 266, 270
- **Description:** All `await fetch()` calls can throw if the upstream is unreachable (DNS failure, connection refused, timeout, TLS error). These are unhandled by any try-catch, causing the proxy to crash with an unhandled promise rejection. In Cloudflare Workers, unhandled rejections can terminate the worker.
- **Suggested fix:** Wrap each `fetch()` call in a try-catch. Return a standardized 502 Bad Gateway response:
  ```ts
  let res: Response;
  try { res = await fetch(url, init); }
  catch { return new Response(JSON.stringify({ error: { type: "upstream_error", message: "Upstream unreachable" } }), { status: 502, headers: { "Content-Type": "application/json" } }); }
  ```

### C3. Missing auth for root `/` info endpoint

- **File:** `/Users/lizhengguang/Documents/Github/opencode-cowork-proxy/src/index.ts`
- **Line:** 290-306 (default fallthrough)
- **Description:** The root path `/` (and `/go`, `/zen` root paths) returns sensitive configuration info (upstream URLs, route map) without requiring any authentication. This leaks internal proxy topology to anyone who can reach the proxy. The CORS `Access-Control-Allow-Origin: *` header makes this accessible from any website.
- **Suggested fix:** Either require auth for the info endpoint, or remove the detailed route map from the public response and return only a health-check status.

---

## HIGH

### H1. Stream response headers do not forward upstream `X-Request-Id` or usage headers

- **File:** `/Users/lizhengguang/Documents/Github/opencode-cowork-proxy/src/index.ts`
- **Lines:** 146-148, 188-190, 242-244
- **Description:** All streaming response paths create a new `Response` object with only `Content-Type`, `Cache-Control`, and `Connection` headers. Upstream headers (especially `X-Request-Id`, rate-limit headers, or any server-timing headers) are silently dropped. This makes debugging upstream issues impossible for streaming requests — clients can't correlate a streamed response with upstream request IDs.
- **Test suggestion:** Write a test that calls a stream-enabled endpoint, mocks the upstream to include `X-Request-Id: abc-123` in the response, and asserts the header appears in the proxy response.
- **Suggested fix:** Forward at minimum `X-Request-Id` from the upstream response to the streaming response. Ideally also forward rate-limit headers:
  ```ts
  const streamHeaders = new Headers({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
  const requestId = res.headers.get("X-Request-Id");
  if (requestId) streamHeaders.set("X-Request-Id", requestId);
  ```

### H2. Non-streaming translated responses lose all upstream headers

- **File:** `/Users/lizhengguang/Documents/Github/opencode-cowork-proxy/src/index.ts`
- **Lines:** 146-153, 188-195, 242-250
- **Description:** Both streaming and non-streaming translated response paths construct a new `Response` object. The non-streaming paths only set `Content-Type: application/json`. This means upstream headers like `X-Request-Id`, rate-limit info (`RateLimit-Remaining`, `RateLimit-Reset`), and custom provider headers are lost. The `upstreamErrorResponse()` function forwards these headers on error responses, but success responses from the same upstream do not get the same treatment — an asymmetry.
- **Test suggestion:** Mock upstream to return rate-limit headers on a 200 success response, call the translated endpoint, and assert those headers appear in the proxy response.
- **Suggested fix:** Collect upstream headers from `res.headers` and merge them into the final `Response`, similar to what `upstreamErrorResponse` does but for success paths. At minimum forward `X-Request-Id` and rate-limit headers.

### H3. Pass-through paths do not handle upstream errors through `upstreamErrorResponse`

- **File:** `/Users/lizhengguang/Documents/Github/opencode-cowork-proxy/src/index.ts`
- **Lines:** 159-165, 198-207
- **Description:** The two pass-through paths (`/v1/messages` with `fmt=anthropic`, and `/v1/chat/completions` with `fmt=openai`) return the upstream response directly via `return anthPassRes` / `return oaiPassRes`. They never check `!res.ok` or call `upstreamErrorResponse`. This means:
  - If the upstream returns a non-JSON error body (e.g., HTML error page), the client receives raw HTML.
  - The CORS headers set by the middleware are on the Hono `c` context, not on the returned Response — depending on Hono's merging behavior, CORS headers might be missing.
  - The error header forwarding in `upstreamErrorResponse` is bypassed.
- **Test suggestion:** Mock upstream to return a 429 with `Retry-After` and `RateLimit-*` headers, send a pass-through request, and assert all forwarded headers appear (or that CORS headers are present).
- **Suggested fix:** Add `if (!res.ok) return upstreamErrorResponse(res, await res.text());` before returning pass-through responses.

### H4. `/v1/chat/completions` pass-through with `fmt=anthropic` does not apply model override to image detection

- **File:** `/Users/lizhengguang/Documents/Github/opencode-cowork-proxy/src/index.ts`
- **Lines:** 199-201
- **Description:** When `fmt` is not `"anthropic"` (i.e., it's `"openai"`), the pass-through code at line 199 reads the body and applies model overrides. But `hasOpenAIImages(oaiReqJson)` is called on line 201 — this only checks for OpenAI-style `image_url` parts. If the request body contains Anthropic-style images (`type: "image"`) sent to `/v1/chat/completions`, the image override is missed. Conversely, images in a request sent to `/v1/messages` go through `hasImages()` (which checks Anthropic format). The format-specific image detection functions are correctly paired with their route paths, but there is no validation that the body format matches the route path, so a client could send mismatched content.
- **Test suggestion:** Write a test that sends `/v1/chat/completions` with Anthropic-style `type: "image"` content blocks and assert that VISION_MODEL is NOT applied (documenting the current behavior), or add a test with correct format that confirms VISION_MODEL IS applied.
- **Suggested fix:** This is more of a design assertion than a code fix. Add a comment at each image-detection call site clarifying the expected body format for that route. Alternatively, for a belt-and-suspenders approach, detect both image formats at every route:

---

## MEDIUM

### M1. `/v1/responses` handler: DeepSeek `thinking` injected after image detection overrides model to VISION_MODEL

- **File:** `/Users/lizhengguang/Documents/Github/opencode-cowork-proxy/src/index.ts`
- **Lines:** 221-228
- **Description:** The order of operations in the `/v1/responses` handler is:
  1. `route.modelOverride` applied (line 218)
  2. DeepSeek thinking injected if `req.model.startsWith('deepseek-')` (lines 221-223)
  3. Vision model override to `VISION_MODEL` if images detected (lines 226-228)

  If `route.modelOverride` sets a DeepSeek model AND the request contains images, step 2 injects `thinking: { type: "enabled" }` into the request body, but step 3 immediately overrides the model to `qwen3.6-plus`. The `thinking` field remains in the request body even though the model is no longer a DeepSeek model. The upstream (`qwen3.6-plus`) might ignore the `thinking` field, but it's still sent unnecessarily.

  If `route.modelOverride` is null and the body model is `deepseek-r1` AND the request contains images, similarly the model becomes `qwen3.6-plus` with `thinking` still set.
- **Test suggestion:** Create a test with `/go/deepseek-r1/v1/responses` with an image in the input, and assert `thinking` is not present in the translated request body.
- **Suggested fix:** Move the vision model override before the DeepSeek thinking injection, and guard the thinking injection with `if (req.model?.startsWith('deepseek-')...` so that if vision override fires, thinking is not injected:
  ```ts
  if (hasResponsesImages(req)) {
    req.model = VISION_MODEL;
  }
  if (req.model?.startsWith('deepseek-') && !req.thinking) {
    req.thinking = { type: "enabled" };
  }
  ```

### M2. Pass-through `/v1/chat/completions` with `fmt=openai` uses `key` param without guaranteed non-null

- **File:** `/Users/lizhengguang/Documents/Github/opencode-cowork-proxy/src/index.ts`
- **Lines:** 170, 204
- **Description:** On line 170, `const key = extractApiKey(request.headers)` returns `string | null`. After `validateApiKey(key)` on line 171, the auth error is checked but TypeScript does not narrow `key` through a function call. On line 204, `\`Bearer ${key}\`` uses `key` which is still typed as `string | null`. With `"strict": true` in tsconfig, this is a type error that goes unchecked because there is no type-check step in the build pipeline. Similarly for the `/v1/messages` pass-through path at line 161 (`anthropicHeaders(request, key!)` — uses `!` non-null assertion which is safe but bypasses type safety).
- **Suggested fix:** Add an explicit type assertion or early return pattern:
  ```ts
  const key = extractApiKey(request.headers);
  const err = validateApiKey(key);
  if (err) return authErrorResponse(err);
  if (!key) return authErrorResponse({ status: 401, body: { ... } }); // redundant but safe
  ```

### M3. `extractUncachedInputTokens` assumes cached tokens are always a subset of input tokens

- **File:** `/Users/lizhengguang/Documents/Github/opencode-cowork-proxy/src/cache.ts`
- **Lines:** 67-69
- **Description:** The function `extractUncachedInputTokens` subtracts `extractCachedTokens()` from `extractInputTokens()`. This assumption is correct for OpenAI-style usage (where `prompt_tokens` includes cached tokens) but incorrect for Anthropic-style usage (where `input_tokens` does NOT include `cache_read_input_tokens` — they are separate counts). If this function were called with an Anthropic-format usage object, it would double-subtract and return an incorrect (lower) token count. The `Math.max(0, ...)` prevents negative values but masks the underlying logic error.
- **Suggested fix:** Add a JSDoc comment clarifying that this function assumes OpenAI-style usage where cached tokens are bundled inside prompt/input tokens. Optionally add a format parameter or check:
  ```ts
  // Assumes OpenAI-style usage: prompt_tokens includes cached tokens
  // Do NOT call with Anthropic-style usage where input_tokens and cache_read_input_tokens are separate
  ```

---

## LOW

### L1. `extractApiKey` for Record type lowercases keys, may not match original-case keys

- **File:** `/Users/lizhengguang/Documents/Github/opencode-cowork-proxy/src/auth.ts`
- **Lines:** 8-9
- **Description:** When `headers` is a `Record<string, string | null>`, the `get` function looks up keys with `name.toLowerCase()`. This expects the Record to have lowercase keys. If a test or caller passes a Record with mixed-case keys (e.g., `{ "X-Api-Key": "sk-..." }`), the lookup `["x-api-key"]` fails and returns `null`. For real `Headers` objects (used in production), `headers.get()` is case-insensitive and works correctly.
- **Suggested fix:** Make the Record lookup case-insensitive by iterating or normalizing:
  ```ts
  return (headers as Record<string, string | null>)[name] ||
         (headers as Record<string, string | null>)[name.toLowerCase()] ||
         null;
  ```

### L2. `getUpstream` does not trim or validate `X-Upstream-Url` header

- **File:** `/Users/lizhengguang/Documents/Github/opencode-cowork-proxy/src/index.ts`
- **Lines:** 58-60
- **Description:** The `X-Upstream-Url` header value is used directly without trimming. If a client sends `" https://evil.com "` (with leading/trailing spaces), the URL would be malformed and `fetch` would fail. This is both a security concern (arbitrary upstream override) and a robustness issue (no URL validation or trimming).
- **Test suggestion:** Write a test with `X-Upstream-Url` containing leading/trailing whitespace and assert it's either handled or rejected.
- **Suggested fix:** Add `.trim()` and basic URL validation:
  ```ts
  function getUpstream(request: Request, routeUpstream: string): string {
    const header = request.headers.get("X-Upstream-Url")?.trim();
    if (header) {
      try { new URL(header); return header; }
      catch { /* fall through to routeUpstream */ }
    }
    return routeUpstream;
  }
  ```

### L3. `hasCacheControl` does not handle Responses API `input` format

- **File:** `/Users/lizhengguang/Documents/Github/opencode-cowork-proxy/src/cache.ts`
- **Lines:** 22-33
- **Description:** The function checks `messages` and `system` for `cache_control` markers, but does not check `input` (the Responses API format). If the `/v1/responses` path were to use `hasCacheControl` in the future (e.g., to inject cache headers), it would miss `cache_control` markers inside `input` items. Currently not a runtime bug because `/v1/responses` does not call this function.
- **Suggested fix:** Add `input` checking support with a comment that it's for Responses API compatibility:
  ```ts
  // Check Responses API input format
  const input = body?.input;
  if (Array.isArray(input)) {
    for (const item of input) {
      if (item.type === "message" && Array.isArray(item.content)) {
        if (item.content.some((block: any) => block.cache_control)) return true;
      }
    }
  }
  ```

### L4. `API_START_PATHS` does not include `v3` or other future API versions

- **File:** `/Users/lizhengguang/Documents/Github/opencode-cowork-proxy/src/index.ts`
- **Line:** 18
- **Description:** `API_START_PATHS` only includes `'v1'` and `'v2'`. If a client sends a request to `/v3/messages`, the path segment `v3` is not recognized as an API version prefix, so `extractModelSegment` treats it as a model name override. This would route `v3` to the upstream as the model name, likely resulting in an upstream error. Similarly for any future API version prefix.
- **Test suggestion:** Test `/v3/messages` and confirm it either works or returns a clear error instead of silently using "v3" as a model name.
- **Suggested fix:** Use a more robust heuristic than a fixed set — for example, check if the segment starts with `v` followed by one or more digits:
  ```ts
  const API_VERSION_PATTERN = /^v\d+$/;
  if (segments.length > 0 && segments[0] && !API_VERSION_PATTERN.test(segments[0])) {
  ```

### L5. `hashSystemPrompt` uses djb2 for cache key hashing (collision risk on large prompts)

- **File:** `/Users/lizhengguang/Documents/Github/opencode-cowork-proxy/src/cache.ts`
- **Lines:** 7-18
- **Description:** The djb2 hash is a simple non-cryptographic hash with a 32-bit output space. For large or numerous system prompts, collisions are theoretically possible but practically unlikely for the use case (node affinity cache keys). Collisions would cause two different system prompts to share a cache slot, which is acceptable because the upstream would still validate the actual prompt text. This is a pre-existing pattern inherited from upstream, not a new bug.
- **Suggested fix:** No action required. If collisions become a real problem, upgrade to a stronger hash (e.g., FNV-1a or SHA-256 truncated) and document the key format.

---

## Cross-Cutting Concerns

### Caching inefficiency in `/v1/models` handler

- **File:** `/Users/lizhengguang/Documents/Github/opencode-cowork-proxy/src/index.ts`
- **Lines:** 260-262
- **Description:** The cache key includes `request` as the init object, which copies headers from the original request. While Cloudflare's Cache API matches on URL (not headers), `caches.default` in Workers might behave differently across runtimes (Bun, Node.js). If tested outside Workers with a mock cache that does match on headers, tests might produce unexpected results.
- **Suggested fix:** Simplify the cache key to only include the URL:
  ```ts
  const cacheKey = new Request(`${upstream}/models?fmt=${fmt}`, { method: "GET" });
  ```

### CORS header merging with custom Response objects

- **File:** `/Users/lizhengguang/Documents/Github/opencode-cowork-proxy/src/index.ts`
- **Line:** 109-113 (upstreamErrorResponse)
- **Description:** The `upstreamErrorResponse` function creates a brand-new `Response` object. Whether Hono's CORS middleware headers (set via `c.header()` before `next()`) are present on this new Response depends on Hono's internal response merging logic. If Hono picks the handler's returned Response over the middleware's context headers, CORS headers could be missing on error responses, causing browser clients to receive opaque errors.
- **Suggested fix:** Either (a) add explicit CORS headers to `upstreamErrorResponse`, or (b) use `c.body()` / `c.json()` instead of returning a new Response object, so the CORS middleware's headers are applied by Hono.

---

## Positives & Verified Correct Behaviors

The following areas were reviewed and are verified correct:

1. **`routeConfig()` URL parsing:** Correctly handles `/go/`, `/zen/`, and no-prefix paths. Model segment extraction correctly skips API version prefixes (`v1`, `v2`).
2. **Model override chain priority:** Image detection > URL path > Body model — correctly implemented in all handlers. `originalModel` captures the body model before overrides, per spec.
3. **Image detection functions:** Each correctly targets its format (`hasImages` = Anthropic `type: "image"`, `hasOpenAIImages` = OpenAI `type: "image_url"`, `hasResponsesImages` = Responses API `type: "input_image"`).
4. **API key extraction:** Correctly checks `X-Api-Key` before `Authorization: Bearer`. Case-insensitive for Headers objects. The 32-character minimum is reasonable.
5. **Token field coverage:** `tokenCount()` covers all known field shapes (snake_case, camelCase, provider-specific). The field ordering correctly prioritizes the most common format.
6. **`extractUncachedInputTokens()`:** Correct for its intended use case (OpenAI -> Anthropic mapping where cached tokens are inside prompt_tokens).
7. **`upstreamErrorResponse()`:** Correctly forwards Content-Type, Retry-After, RateLimit-*, X-Request-Id headers.
8. **No body double-read:** All route paths consume `request.json()` exactly once (verified per-path).
9. **Edge case handling:** Empty messages, no images, missing model field — all handled gracefully by the image detection and model override chain. The root `/` path correctly returns 200.
10. **Unknown paths:** Fall through to 404 response. Correct.
