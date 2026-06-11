# Product Specifications

> Feature overview of the opencode-cowork-proxy, organized by capability.

## 1. API Translation

### 1.1 Anthropic Messages -> OpenAI Chat Completions

- **Endpoint**: `POST /v1/messages`
- **Default translation**: Anthropic body -> OpenAI body (when `X-Upstream-Format: openai` or omitted)
- **Pass-through**: Forward as Anthropic body (when `X-Upstream-Format: anthropic`)
- **Response translation**: OpenAI response -> Anthropic response format (non-streaming)
- **Stream translation**: OpenAI SSE -> Anthropic SSE event stream
- **Auth**: Anthropic-style auth (`X-Api-Key`, `Anthropic-Version`, `Anthropic-Beta` headers)

### 1.2 OpenAI Chat Completions -> Anthropic Messages

- **Endpoint**: `POST /v1/chat/completions`
- **Default translation**: OpenAI body -> Anthropic body (when `X-Upstream-Format: anthropic`)
- **Pass-through**: Forward as OpenAI body (when `X-Upstream-Format: openai`)
- **Response translation**: Anthropic response -> OpenAI response format (non-streaming)
- **Stream translation**: Anthropic SSE -> OpenAI SSE event stream
- **Auth**: OpenAI-style auth (`Authorization: Bearer`)

### 1.3 OpenAI Responses API -> Chat Completions

- **Endpoint**: `POST /v1/responses`
- **Translation**: Responses API body -> Chat Completions body (one-directional, no reverse)
- **Response translation**: Chat Completions response -> Responses API format (non-streaming)
- **Stream translation**: Chat Completions SSE -> Responses API named-event SSE stream
- **Special handling**: Auto-inject `thinking: {type: "enabled"}` for DeepSeek models; strip `<think>` tags for minimax-m3-free models
- **Auth**: OpenAI-style auth

## 2. Model Routing

### 2.1 Upstream Selection

| Route | Upstream | Description |
|-------|----------|-------------|
| `/go/*` | `https://opencode.ai/zen/go` | Go upstream (default) |
| `/zen/*` | `https://opencode.ai/zen` | Zen upstream |
| `/*` | `https://opencode.ai/zen/go` | Default (Go) |
| `X-Upstream-Url` header | Any valid URL | Header-based override |

### 2.2 Model Override

- **URL segment override**: First URL segment that doesn't look like `v1` becomes model override.
- **Vision model override**: Auto-switch to vision-capable model when images detected.
- **Override chain**: URL -> Vision -> DeepSeek thinking injection (strict order).

### 2.3 Vision Model Selection

- **Go upstream default vision model**: `qwen3.6-plus`
- **Zen upstream default vision model**: `mimo-v2.5-free`
- **Preservation**: If requested model is already vision-capable for the target upstream, it is preserved (not replaced with the default).

## 3. Model List Proxy

### 3.1 Endpoint

- `GET /v1/models` -- Proxies upstream model list.
- **Cache**: Cloudflare Cache API, 300s TTL, URL-based cache key.
- **Auth**: Required (format-aware auth headers).

### 3.2 Cache Behavior

- Cache is checked before upstream fetch.
- Cache key is auth-independent (URL + format only).
- Cache PUT is fire-and-forget (does not block response).
- Falls back to direct fetch if cache API unavailable (e.g., Bun local mode).

## 4. Health Check

### 4.1 Endpoint

- `GET /` -- Returns service metadata.
- **No auth required**.
- **Response fields**: name, version, status, uptime, upstream URL, routes, endpoint documentation.

## 5. Deployment Targets

### 5.1 Cloudflare Workers

- **Entry**: `src/index.ts` (via wrangler.toml)
- **Features**: Global edge network, Cache API, free tier

### 5.2 Bun Standalone Binary

- **Entry**: `scripts/build-entry.ts` (Bun.serve)
- **Build**: `bun build --compile --outfile opencode-cowork-proxy scripts/build-entry.ts`
- **Run**: Direct binary or `brew services`
- **Port**: 8787 (default, `PORT` env override)

### 5.3 Vercel Serverless

<!-- Vercel config removed -->
- **Entry**: Hono app served via Vercel adapter

## 6. Request/Response Processing

### 6.1 Body Size Limit

- Maximum: 10 MB
- Check: Before any processing begins
- Response: HTTP 413

### 6.2 Retry Policy

- Retryable: 5xx, network errors
- Non-retryable: 4xx, streaming requests, success
- Max retries: 2 (3 total attempts)
- Backoff: Exponential with jitter (500ms * 2^attempt + 0-200ms, max 10s)

### 6.3 Content Encoding

- Gzip compression for responses over 1KB (when client supports it)
- Accept-Encoding: gzip respected
- Vary: Accept-Encoding header added for compressed responses

## 7. Authentication

- **Key sources**: X-Api-Key header (preferred), Authorization: Bearer (fallback)
- **Validation**: Minimum 32 characters
- **Format awareness**: Error response format matches client path (Anthropic format for /v1/messages, OpenAI format otherwise)
