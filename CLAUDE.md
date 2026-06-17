## Harness: opencode-cowork-proxy

**Goal:** Bidirectional AI API translation gateway — Anthropic↔OpenAI↔Responses API format bridge deployed on Cloudflare Workers.

## Quick Start

```bash
bun install          # install dependencies
bun run dev          # start local dev server on port 8787
bun test             # run 521 tests across 28 test files
bun run typecheck    # TypeScript type check
bunx wrangler deploy # deploy to Cloudflare Workers
bun run build        # CF Worker bundle (minified, ./dist/)
bun run build:binary # standalone macOS binary via bun build --compile
```

## Architecture Constraints

| Rule | Detail |
|------|--------|
| **`translate/` is pure** | No I/O, no fetch, no fs — format logic only |
| **Parse-Don't-Validate** | Parse incoming requests into typed domain objects at handler boundaries via Zod v4 |
| **Source ≤ 500 lines** | Split files before exceeding |
| **FormatPairs** | Each direction (Anthropic↔OpenAI etc.) has request/response/stream translators registered via `TranslatorRegistry` |

## Skill Map

| When you need… | Use skill |
|----------------|-----------|
| Format translation issues | `format-translation` (`.claude/skills/format-translation/`) |
| Provider routing / upstream config | `provider-routing` (`.claude/skills/provider-routing/`) |
| Streaming / SSE / backpressure | `streaming` (`.claude/skills/streaming/`) |
| Request pipeline / auth / audit | `request-pipeline` (`.claude/skills/request-pipeline/`) |
| Running / debugging tests | `testing` (`.claude/skills/testing/`) |
| Deploy to CF Workers / binary | `deployment` (`.claude/skills/deployment/`) |
| Security review (auth, injection) | `security-review` (`.claude/skills/security-review/`) |
| Code quality / architecture review | `quality-gate` (`.claude/skills/quality-gate/`) |
| Harness team orchestration | `harness-orchestrator` (`.claude/skills/harness-orchestrator/`) |
| Code reuse / simplification | Skill: `simplify` |
| Bug-hunting code review | Skill: `code-review` |

## Key Source Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Hono app, route dispatch, CORS |
| `src/handlers/` | 9 request handlers (messages, chat-completions, responses, etc.) |
| `src/translate/` | Plugin-registry format translation (request/response/stream) |
| `src/providers.ts` | Provider registry + routing |
| `src/routing.ts` | URL prefix routing + model override |
| `src/validate.ts` | Zod v4 request body validation |
| `src/config.ts` | Vision model sets, constants |
| `src/audit.ts` | Audit event logging (ring buffer) |
| `src/rate-limit.ts` | Upstream rate-limit header tracking |
| `src/response-cache.ts` | In-memory LRU response cache |
| `src/backpressure.ts` | Streaming backpressure control |
| `src/compress.ts` | Gzip compression for responses |
| `src/vision.ts` | Vision/image routing (auto-switch to vision-capable models) |

## Non-obvious Behaviors

| Behavior | Detail |
|----------|--------|
| **Vision auto-reroute** | `src/vision.ts` detects image content blocks → model overrides to `qwen3.6-plus` (/go) or `mimo-v2.5-free` (/zen) |
| **Think-tag stripping** | `src/think-tag-stripper.ts` strips `<think>...</think>` blocks for DeepSeek models only |
| **Body size gate** | All POST bodies checked against 10 MB limit (`MAX_BODY_SIZE` in config.ts) before any JSON parsing |
| **Upstream retry** | Upstream fetch retries twice on transient failures before returning 5xx |
| **Dual-path handlers** | Each POST handler decides translate vs pass-through based on `X-Upstream-Format` header |
| **Audit ring buffer** | In-memory ring buffer capped at 1000 events — lost on restart (no persistence) |

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_BASE_URL` | Yes | Upstream endpoint (e.g. `http://localhost:18787/zen`) |
| `ANTHROPIC_AUTH_TOKEN` | Yes | API key for upstream auth |

## Navigation

- Change history → @ref:docs/CHANGELOG.md
- Architecture deep-dive → @ref:docs/ARCHITECTURE.md
- Testing → @ref:docs/TESTING.md
- Security → @ref:docs/SECURITY.md
- Deployment → @ref:docs/OPERATIONS.md
