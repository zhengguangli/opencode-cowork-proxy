# OpenCode Cowork Proxy Worker

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cucoleadan/opencode-cowork-proxy)

This project lets Claude use OpenCode Go models, and some OpenCode Zen models.

Claude normally speaks the Anthropic API format. OpenCode Go mostly speaks OpenAI-compatible API format. This small Cloudflare Worker sits in the middle and translates between them.

I covered how to set this up in Claude in [How to Use Claude Code for Free with OpenCode](https://vibestacklab.substack.com/p/how-to-use-claude-code-for-free-with).

### Image / Vision Support

When you attach an image in Claude Code and send it through this proxy, the request is automatically routed to **Qwen3.6 Plus** (`qwen3.6-plus`) — a vision-capable model available on both OpenCode Go and OpenCode Zen. This happens transparently: the proxy detects image blocks in your request, translates them to OpenAI's image format, and overrides the model to Qwen3.6 Plus so the model can actually see the image.

No configuration needed — it just works as long as you have an OpenCode Go or Zen subscription.

## Local Deployment (macOS LaunchAgent)

The proxy can also run as a standalone Bun HTTP server via `server.ts`, managed by `launchctl` for automatic startup on login.

### Build

```bash
bun build --compile --outfile opencode-cowork-proxy server.ts
```

This produces a standalone `opencode-cowork-proxy` binary (Mach-O, no runtime dependencies). Copy it to `/usr/local/bin/`:

```bash
cp opencode-cowork-proxy /usr/local/bin/opencode-cowork-proxy
```

### LaunchAgent Plist

Create `~/Library/LaunchAgents/ai.opencode.proxy.plist`:

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
    <key>StandardOutPath</key>
    <string>/usr/local/var/log/opencode-cowork-proxy.log</string>
    <key>StandardErrorPath</key>
    <string>/usr/local/var/log/opencode-cowork-proxy.log</string>
</dict>
</plist>
```

### Load / Unload

```bash
launchctl load ~/Library/LaunchAgents/ai.opencode.proxy.plist
launchctl unload ~/Library/LaunchAgents/ai.opencode.proxy.plist
```

To restart after rebuilding:

```bash
cd /path/to/project
bun build --compile --outfile opencode-cowork-proxy server.ts
sudo cp opencode-cowork-proxy /usr/local/bin/
launchctl unload ~/Library/LaunchAgents/ai.opencode.proxy.plist
launchctl load ~/Library/LaunchAgents/ai.opencode.proxy.plist
```

### Verify

```bash
launchctl print gui/$(id -u)/ai.opencode.proxy
tail -f /usr/local/var/log/opencode-cowork-proxy.log
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

The Worker accepts Claude's Anthropic-style requests at `/v1/messages`, converts them to OpenAI-style requests, and sends them to OpenCode Go by default.

You can choose an OpenCode upstream by adding a prefix to the Worker URL:

| Worker URL suffix | Upstream |
|-------------------|----------|
| no suffix | OpenCode Go |
| `/go` | OpenCode Go |
| `/zen` | OpenCode Zen |

For example, use `YOUR_DEPLOYED_WORKER_URL/go` for Go models and `YOUR_DEPLOYED_WORKER_URL/zen` for Zen models.

It also handles tool calls, streaming, and DeepSeek reasoning output so coding-agent workflows work correctly.

Important: this proxy has been live-tested with `minimax-m3` and `minimax-m2.7`. Other OpenCode Go models are included from the public OpenCode Go model list, but provider behavior can vary, especially around streaming usage/token accounting.

## Important Zen Limitation

OpenCode Zen support is partial.

This proxy currently works with Zen models that use the OpenAI-compatible `/chat/completions` endpoint.

Known Zen model categories that should work through `/zen`:

| Zen model category | Examples |
|--------------------|----------|
| OpenAI-compatible chat models | `minimax-m2.7`, `minimax-m2.5`, `mimo-v2.5-free`, `glm-5.1`, `glm-5`, `kimi-k2.5`, `kimi-k2.6`, `grok-build-0.1`, `big-pickle`, `deepseek-v4-flash`, `deepseek-v4-flash-free`, `nemotron-3-super-free` |

Known Zen model categories that do not work yet through this proxy:

| Zen model category | Why it does not work yet |
|--------------------|--------------------------|
| GPT models such as `gpt-5.5`, `gpt-5.5-pro`, `gpt-5.4`, `gpt-5.4-pro`, `gpt-5.3-codex`, `gpt-5.2` | Zen exposes these through `/responses`, and this proxy does not yet translate Anthropic Messages to OpenAI Responses API. |
| Claude models such as `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5` | Zen exposes these through `/messages`; this proxy's `/zen` Claude path currently translates to OpenAI format for the Go upstream. A `/zen/claude` sub-route or pass-through may be added later. |
| DeepSeek V4 Pro, DeepSeek V4 Flash | Already available on Go (paid) — behavior on Zen may differ. |

## OpenCode Go Models

This proxy is tested with `minimax-m3`. It also provides access to all OpenCode Go models listed in its public model manifest.

The built-in model list is compiled from the [opencode.ai/models](https://opencode.ai/models) page (see `src/models.ts`).

```json
{
  "models": [
    {
      "name": "deepseek-v4-pro"
    },
    {
      "name": "deepseek-v4-flash"
    },
    {
      "name": "deepseek-v4-flash-free"
    },
    {
      "name": "minimax-m3"
    },
    {
      "name": "minimax-m2.7"
    },
    {
      "name": "minimax-m2.5"
    },
    {
      "name": "qwen3.7-max"
    },
    {
      "name": "qwen3.6-plus"
    }
  ]
}
```

## Deploy On Cloudflare

This project is intended to run as a Cloudflare Worker. Deploy it to Cloudflare using either the deploy button above or Cloudflare's Git-based Worker deployment flow.

Use these settings when connecting the repository in Cloudflare:

| Setting | Value |
|---------|-------|
| Build command | empty |
| Deploy command | `bun run deploy` |
| Production branch | `main` |

Do not deploy this as a normal Node.js web app. `wrangler deploy` builds and publishes the Worker from `wrangler.toml`.

## Configuration

The Worker is zero-config by default. It forwards to OpenCode Go using OpenAI-compatible format. You can also route to OpenCode Zen by adding `/zen` to the Worker URL.

Optional request headers:

| Header | Default | Description |
|--------|---------|-------------|
| `x-upstream-url` | `https://opencode.ai/zen/go/v1` | Upstream API base URL |
| `x-upstream-format` | `openai` | Upstream format: `openai` or `anthropic` |
| `x-api-key` | required | Upstream API key |
| `authorization` | optional | `Bearer <key>` also works |
| `anthropic-version` | `2023-06-01` | Forwarded when calling Anthropic-compatible upstreams |
| `anthropic-beta` | unset | Forwarded when calling Anthropic-compatible upstreams |

The API key is validated locally before any upstream call. Missing or short keys receive a 401 response.

Prefix routes:

| Path prefix | Upstream base URL |
|-------------|-------------------|
| `/go` | `https://opencode.ai/zen/go/v1` |
| `/zen` | `https://opencode.ai/zen/v1` |

### Model Name Override

Claude Desktop may reject model names that don't look like Anthropic models (e.g. `claude-sonnet-4-5` or `anthropic/claude-*`). To work around this, embed the real model name in the URL path after the prefix:

```
YOUR_DEPLOYED_WORKER_URL/zen/mimo-v2.5-free   # free Zen models
YOUR_DEPLOYED_WORKER_URL/go/deepseek-v4-pro   # paid Go models
```

Claude appends `/v1/messages`, so the full request becomes `YOUR_WORKER_URL/zen/mimo-v2.5-free/v1/messages`. The proxy extracts the model from the path and uses it regardless of what Claude sends in the request body.

**Usage:**
1. Configure Claude with any Anthropic-looking model name (e.g. `claude-sonnet-4-5-20250514`) — this passes Claude's client-side validation.
2. Set the base URL to `YOUR_WORKER_URL/zen/REAL_MODEL_ID` (replace `REAL_MODEL_ID` with the actual OpenCode model).
3. The proxy silently maps the model for the upstream request.
4. The response uses the original model name you configured, so Claude sees consistency.

| Setting | Value |
|---------|-------|
| Base URL | `YOUR_WORKER_URL/zen/mimo-v2.5-free` |
| Auth scheme | `x-api-key` |
| API key | Your OpenCode API key |
| Model | `claude-sonnet-4-5-20250514` (any Anthropic-looking name) |

This works with all Go and Zen models.

## API Endpoints

| Path | Method | Purpose |
|------|--------|---------|
| `/v1/messages` | POST | Anthropic Messages API. Translates to OpenAI format by default. |
| `/v1/chat/completions` | POST | OpenAI Chat Completions API. Pass-through by default. |
| `/v1/models` | GET | Model discovery proxy. |
| `/v1/responses` | POST | OpenAI Responses API. Translates to/from Chat Completions internally. |

## OpenAI SDK Usage

Point any OpenAI-compatible client at the gateway. By default, `/v1/chat/completions` passes through to OpenCode Go.

```python
from openai import OpenAI

client = OpenAI(
    base_url="YOUR_DEPLOYED_WORKER_URL/v1",
    api_key="your-opencode-go-api-key",
)

response = client.chat.completions.create(
    model="deepseek-v4-pro",
    messages=[{"role": "user", "content": "Hello"}],
)
```

## OpenAI SDK To Anthropic

Set `x-upstream-format: anthropic` and point `x-upstream-url` at an Anthropic-compatible API.

```bash
curl YOUR_DEPLOYED_WORKER_URL/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ANTHROPIC_KEY" \
  -H "x-upstream-url: https://api.anthropic.com" \
  -H "x-upstream-format: anthropic" \
  -d '{"model":"claude-sonnet-4-20250514","messages":[{"role":"user","content":"Hello"}]}'
```

## Translation Notes

The gateway handles:

- Anthropic Messages requests to OpenAI Chat Completions requests
- OpenAI Chat Completions responses to Anthropic Messages responses
- Tool calls and tool results in both directions
- Streaming SSE in both directions
- DeepSeek/OpenAI `reasoning_content` as Anthropic `thinking` blocks
- Prompt cache key injection for OpenAI-style prefix caching
- OpenAI Responses API to/from Chat Completions internal translation

## Prompt Caching

When translating Anthropic to OpenAI, the gateway injects a `prompt_cache_key` derived from a hash of the system prompt. This keeps requests with the same system prompt routed to the same backend node when the upstream supports OpenAI-style prefix caching.

Cache hit tokens from OpenAI-compatible usage metadata are mapped back to Anthropic's `cache_read_input_tokens` field.

## Development

```bash
bun install
bun test
bun run deploy -- --dry-run
```

Project structure:

```text
src/
├── index.ts                          Main Worker router and auth gate
├── auth.ts                           API key extraction and validation
├── cache.ts                          Prompt cache key utilities
└── translate/
    ├── request/                      Request translators
    ├── response/                     Response translators
    └── stream/                       SSE stream translators
test/
├── auth.test.ts
├── cache.test.ts
├── index.test.ts
├── request.test.ts
├── response.test.ts
└── stream.test.ts
```

## License

MIT. See [LICENSE](LICENSE).
