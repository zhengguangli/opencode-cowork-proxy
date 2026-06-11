# Reliability: opencode-cowork-proxy

> Upstream failover strategy, timeout and retry handling, Cloudflare Workers reliability model, and monitoring approach.

## 1. Upstream Provider Architecture

The proxy routes requests to a single upstream provider (opencode.ai) via two paths:
- `/go` -> `https://opencode.ai/zen/go` (default upstream)
- `/zen` -> `https://opencode.ai/zen`

### 1.1 Failover

There is **no automatic failover** between upstream paths. The proxy does not know if an upstream is healthy before sending a request. Failover is manual:

1. **Client-side failover**: The client switches URL prefix from `/go` to `/zen`, or uses `X-Upstream-Url` header for arbitrary upstream.
2. **URL prefix routing**: Built into the routing layer -- switching prefix changes the upstream without code changes.

The `/v1/models` handler has a 300s cache that reduces upstream load, but stale cache does not degrade service (it only serves outdated model lists).

### 1.2 Upstream Health Detection

The `GET /` health endpoint returns the configured upstream URLs and service status. It does not validate upstream reachability (the proxy is stateless and cannot health-check without making actual requests that would count against upstream rate limits).

## 2. Timeout and Retry Handling

### 2.1 Timeouts

| Scenario | Timeout | Source |
|----------|---------|--------|
| Non-streaming upstream request | 60s | `DEFAULT_TIMEOUT` in config.ts |
| Model list fetch | 10s | `MODEL_LIST_TIMEOUT` in config.ts |
| Stream idle timeout | 120s | `STREAM_TIMEOUT` in config.ts |
| Stream client disconnect | Immediate | `request.signal` listener |

Streaming timeout uses a dual-signal approach (`createStreamSignal()`): a timeout fires after 120s, AND the client's abort signal is wired to the upstream abort controller. Whichever fires first aborts the request.

### 2.2 Retry Policy

Implemented in `safeUpstreamFetch()`:

- **Retryable**: HTTP 5xx errors, network failures.
- **Not retryable**: HTTP 4xx (including 429 rate limits), successful responses.
- **Not retried**: Streaming requests -- SSE cannot be replayed.
- **Max retries**: 2 (3 total attempts including the first).
- **Backoff**: Exponential `500ms * 2^attempt` with full jitter (+0-200ms random), capped at 10s.
- **Debug logging**: When `DEBUG` env var is set, retry events are logged via `console.log`.

### 2.3 Error Response Handling

Upstream error responses (any non-2xx) are forwarded to the client unchanged via `upstreamErrorResponse()`. The original status code, body, and key headers (Content-Type, Retry-After, rate-limit headers) are preserved.

## 3. Cloudflare Workers Reliability Model

### 3.1 Stateless Design

The proxy maintains no in-memory state across requests. Each request is handled independently:
- No request queues.
- No session state.
- No connection pooling (Cloudflare manages HTTP connections).

This means **no state to recover** after a worker restart. Cold starts are sub-second and require no initialization beyond importing modules.

### 3.2 Memory Constraints

Cloudflare Workers have limited memory (typically 128 MB). The proxy is designed for minimal memory footprint:
- Stream backpressure via `applyBackpressure()` prevents unbounded buffering in stream translations.
- Response gzip compression trades CPU for bandwidth.
- Model list cache is optional and fire-and-forget (cache miss does not block response).
- Body size gate prevents oversized payloads from consuming memory.

### 3.3 Worker Graceful Shutdown

Cloudflare Workers can be terminated at any time. Since the proxy is stateless, termination only affects in-flight requests. Streaming connections are aborted via the abort signal mechanism.

## 4. Monitoring Approach

### 4.1 Built-in Observability

- **Health endpoint** (`GET /`): Returns service name, version, uptime, upstream URLs, available endpoints.
- **Debug logging** (`DEBUG` env var): Enables verbose console.log output in handlers (input/output inspection, retry events, Responses API translation tracing).
- **Bun standalone logging**: The Bun server logs each request: `METHOD /path STATUS MSms`.

### 4.2 No External Monitoring

The proxy ships with no external monitoring integration:
- No metrics endpoint.
- No structured logging.
- No tracing headers propagation.
- No error reporting integration.

External monitoring must be added at the deployment layer (Cloudflare Workers dashboard analytics, Vercel analytics, or a reverse proxy like nginx).

### 4.3 Cloudflare Workers Dashboard

When deployed to Cloudflare Workers, the dashboard provides:
- Request count, latency, status code distribution.
- CPU time and duration per request.
- Subrequest count (upstream fetch calls).
- Error rate tracking.
