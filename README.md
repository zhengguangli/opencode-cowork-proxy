# OpenCode Cowork Proxy Worker

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cucoleadan/opencode-cowork-proxy)

This project lets Claude use OpenCode Go models, and some OpenCode Zen models.

Claude normally speaks the Anthropic API format. OpenCode Go mostly speaks OpenAI-compatible API format. This small Cloudflare Worker sits in the middle and translates between them.

I covered how to set this up in Claude in [How to Use Claude Code for Free with OpenCode](https://vibestacklab.substack.com/p/how-to-use-claude-code-for-free-with).

### Image / Vision Support

When you attach an image in Claude Code and send it through this proxy, the request is automatically routed to **Qwen3.6 Plus** (`qwen3.6-plus`) — a vision-capable model available on both OpenCode Go and OpenCode Zen. This happens transparently: the proxy detects image blocks in your request, translates them to OpenAI's image format, and overrides the model to Qwen3.6 Plus so the model can actually see the image.

No configuration needed — it just works as long as you have an OpenCode Go or Zen subscription.

## Local Deployment (macOS)

### Build (standalone binary)

```bash
bun install
bun run build:binary
```

This produces a standalone `opencode-cowork-proxy` binary (no runtime dependencies).

### Install via Homebrew

```bash
# Copy to Homebrew-managed path
cp ./dist/opencode-cowork-proxy /usr/local/opt/opencode-cowork-proxy/bin/

# Start as a background service
brew services restart opencode-cowork-proxy

# Check status
brew services list | grep opencode
```

### Manual LaunchAgent

Or create `~/Library/LaunchAgents/ai.opencode.proxy.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.opencode.proxy</string>
    <key>Program</key>
    <string>/usr/local/bin/opencode-cowork-proxy</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT</key>
        <string>18787</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/ai.opencode.proxy.plist
```

### Verify

```bash
curl http://localhost:18787/
# {"name":"opencode-cowork-proxy","version":"2.1.5","status":"ok","uptime":"1m 23s",...}
```

## Free Models

We support a pay-as-you-go model. Below are the prices per 1M tokens for completely free models available through OpenCode Zen.

| Model | Model ID | Input | Output | Cached Read |
|-------|----------|-------|--------|-------------|
| Big Pickle | `big-pickle` | Free | Free | Free |
| DeepSeek V4 Flash Free | `deepseek-v4-flash-free` | Free | Free | Free |
| MiMo-V2.5 Free | `mimo-v2.5-free` | Free | Free | Free |
| Nemotron 3 Super Free | `nemotron-3-super-free` | Free | Free | Free |

These models are available at `https://opencode.ai/zen/v1/chat/completions` via the `/zen` prefix. For the full model list and latest pricing, see the [OpenCode Zen endpoint docs](https://opencode.ai/docs/zen/#endpoints).

## Set Up In Claude

If you want the fastest working setup, use `mimo-v2.5-free` as the first model.

1. Deploy this Worker to Cloudflare.
2. Copy your deployed Worker URL.
3. In Claude, open **Configure third-party Inference**.
4. Choose the gateway / third-party inference option.
5. Set the base URL to `YOUR_DEPLOYED_WORKER_URL/zen`.
6. Set the auth scheme to `x-api-key`.
7. Paste your OpenCode API key.
8. Add `mimo-v2.5-free` as the model name.

Important: do not add `/v1/messages` to the URL. Claude adds that path automatically.

## Quick Claude Configuration

Use these values in Claude's **Configure third-party Inference** screen:

| Setting | Value |
|---------|-------|
| Provider | Gateway / third-party inference gateway |
| Base URL | `YOUR_DEPLOYED_WORKER_URL/zen` |
| Auth scheme | `x-api-key` |
| API key | Your OpenCode API key |
| Models | Add manually, for example `mimo-v2.5-free` |

For the default example above, use `/zen` because `mimo-v2.5-free` is a Zen model. Use `/go` for OpenCode Go models instead. Do not add `/v1/messages` yourself. Claude adds the API path automatically.

## What This Does

The Worker accepts Claude's Anthropic-style requests at `/v1/messages` and translates them before sending to OpenCode Go (or OpenCode Zen) at their OpenAI-compatible endpoint. Responses are translated back to Anthropic format. It also supports OpenAI SDK clients sending to `/v1/chat/completions` (pass-through to OpenAI upstream, or translate to Anthropic) and the OpenAI Responses API at `/v1/responses`.

It adds support for:
- Image/vision model routing — transparently switches to Qwen3.6 Plus when images are detected
- DeepSeek thinking/reasoning blocks — automatically injects `thinking: {type: "enabled"}` for DeepSeek models
- Tool use / function calling in both directions
- Streaming SSE in all three API formats
- Prompt caching from system prompt hash for OpenAI node affinity
- Gzip response compression (including SSE streams)
- Prometheus-format metrics for observability
- Zod-validated request bodies with detailed error messages
- Structured audit logging for security events
- Auto-tracked upstream rate-limit headers with low-quota warnings

## API Endpoints

| Path | Method | Purpose | Auth |
|------|--------|---------|------|
| `/v1/messages` | POST | Anthropic Messages API — translates to OpenAI format | Required |
| `/v1/chat/completions` | POST | OpenAI Chat Completions API — pass-through or translate to Anthropic | Required |
| `/v1/responses` | POST | OpenAI Responses API — internally translates to Chat Completions | Required |
| `/v1/models` | GET | Model list — proxied from upstream with 5min Cloudflare Cache | Required |
| `/` | GET | Health check — service info, version, uptime, endpoints | None |
| `/metrics` | GET | Prometheus-format metrics (requests, latency, upstreams, streams) | None |
| `/health/upstream` | GET | Upstream connectivity — add `?probe=true` for live probe | None |
| `/audit/log` | GET | Recent audit events from in-memory ring buffer (max 1000) | None |
| `/ws/v1/messages` | GET | WebSocket upgrade — returns 426 with SSE fallback instructions | Required |

## Configuration

Requests are sent by default to OpenCode Go at `https://opencode.ai/zen/go/v1`. See [Configuration section](#configuration) for header-based overrides.

### Routing

Prefix routes:

| Path prefix | Upstream base URL |
|-------------|-------------------|
| `/go` | `https://opencode.ai/zen/go/v1` |
| `/zen` | `https://opencode.ai/zen/v1` |

### Headers

| Header | Default | Description |
|--------|---------|-------------|
| `x-upstream-url` | Route-based | Override upstream base URL |
| `x-upstream-format` | `openai` | Upstream format: `openai` or `anthropic` |
| `x-api-key` | required | Upstream API key |
| `authorization` | optional | `Bearer <key>` also accepted |

### Model Name Override

Embed the real model name in the URL path after the prefix:

```
YOUR_WORKER_URL/zen/mimo-v2.5-free/v1/messages
```

The proxy extracts the model from the path and uses it regardless of what the client sends in the request body.

## OpenAI SDK Usage

```python
from openai import OpenAI

client = OpenAI(
    base_url="YOUR_DEPLOYED_WORKER_URL/v1",
    api_key="your-api-key",
)

response = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=[{"role": "user", "content": "Hello"}],
)
```

## Translation Notes

The gateway handles:

- Anthropic Messages requests to OpenAI Chat Completions requests
- OpenAI Chat Completions responses to Anthropic Messages responses
- Tool calls and tool results in both directions
- Streaming SSE in both directions
- DeepSeek/OpenAI `reasoning_content` as Anthropic `thinking` blocks
- OpenAI Responses API to/from Chat Completions internal translation
- Think tag stripping (`<think>...</think>`) for models that embed reasoning in text

## Observability

### Metrics

```bash
curl http://localhost:18787/metrics
```

Returns Prometheus-format metrics:
- `http_requests_total` — by method, path, status code
- `http_request_duration_ms` — histogram with configurable buckets
- `upstream_requests_total` — by upstream target
- `upstream_errors_total` — by upstream target and status
- `active_streams` — currently active streaming connections
- `uptime_seconds` — proxy uptime

### Upstream Health

```bash
# Config-only (no request)
curl http://localhost:18787/health/upstream

# Live probe (hits upstream /v1/models with 10s timeout)
curl http://localhost:18787/health/upstream?probe=true
```

### Audit Log

```bash
curl http://localhost:18787/audit/log?limit=50
```

Returns the last 50 security-relevant events (auth, upstream switches, model overrides, errors).

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/load-test.mjs` | Load testing with concurrency support |
| `scripts/audit-deps.mjs` | Dependency vulnerability scanning |
| `scripts/generate-openapi.mjs` | OpenAPI spec generation (→ `docs/openapi.json`) |
| `scripts/install.mjs` | Harness structure verification |

## Development

```bash
bun install
bun test                 # Run 521 tests across 28 files
bun run typecheck         # TypeScript check (0 errors expected)
bun run dev              # Local server on port 8787
bun run build:binary     # Compile standalone binary
```

Project structure:

```text
src/
├── index.ts                 Main Hono router and request handler
├── auth.ts                  API key extraction and format validation
├── audit.ts                 Structured audit logging
├── compress.ts              Streaming gzip compression
├── config.ts                Project-wide configuration
├── logger.ts                Unified structured logger
├── providers.ts             Upstream provider registry
├── rate-limit.ts            Rate-limit header tracking
├── request.ts               Request utilities and upstream fetch
├── response-cache.ts        In-memory LRU response cache
├── routing.ts               URL parsing and model override logic
├── validate.ts              Zod v4 request body validation
├── vision.ts                Image detection and vision model routing
├── handlers/                7 handler modules (messages, chat-completions,
│                            responses, models, health, metrics, health-upstream,
│                            audit-log, websocket)
└── translate/               Plugin architecture with 3 registered format pairs
    ├── plugin.ts            Translator interfaces + registry
    ├── registry.ts          Built-in format pair registration
    ├── request/             3 request translators
    ├── response/            3 response translators
    └── stream/              3 SSE stream translators

scripts/
├── build-entry.ts           Bun standalone server
├── load-test.mjs            Load testing tool
├── audit-deps.mjs           Dependency audit
└── generate-openapi.mjs     OpenAPI spec generator

test/                        28 test files, 521 tests
└── architecture.test.ts     Architecture boundary enforcement (127 checks)
```

## License

MIT. See [LICENSE](LICENSE).
