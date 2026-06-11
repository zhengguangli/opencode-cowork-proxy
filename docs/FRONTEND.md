# Frontend: opencode-cowork-proxy

This is a **backend-only API proxy**. No frontend exists.

## What This Project Does

- Accepts HTTP API requests from AI client SDKs (Anthropic SDK, OpenAI SDK, Codex CLI).
- Translates request/response formats between Anthropic and OpenAI.
- Forwards to upstream AI API provider (opencode.ai).
- Returns translated responses.

## How It Is Used

Clients interact with the proxy programmatically via HTTP API calls, not through a web UI:

```typescript
// Example: Claude Code configured with a custom proxy endpoint
// CLAUDE.md: export CLAUDE_PROXY_URL=https://your-proxy.example.com
```

The only human-facing endpoint is `GET /` which returns a JSON health check payload (no HTML).

## If a Frontend Were to Be Added

This would require a new package or subdirectory for UI assets. The proxy code itself has no UI-related dependencies or build tooling. Any frontend would be deployed separately and communicate with this proxy as an API agent.
