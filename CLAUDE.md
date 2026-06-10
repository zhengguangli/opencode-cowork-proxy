# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🏗️ Harness: OpenCode Cowork Proxy

**Goal:** Anthropic↔OpenAI and OpenAI Responses API translation gateway (Hono app, deployable to Cloudflare Workers, Vercel, or macOS standalone binary).

**Trigger:** For proxy-related work (translation bugs, streaming issues, routing changes, model updates, code review, deployment, testing, performance audit, investigation-only diagnosis), answer directly from the documentation below. The 7-agent Harness Engineering system in `.claude/agents/` and 11 skills in `.claude/skills/` provide automated support when needed. Use `harness-orchestrator` skill for multi-agent orchestration.

**Harness Change History:**

| Date | Change | Target | Reason |
|------|--------|--------|--------|
| 2026-06-10 | Agent 可读性优化 | src/, docs/ | 新增 19 个 src 文件 "WHEN TO READ" 文件头 + 9 个 docs "何时读此文件" 指引 + 超时值常量化 |
| 2026-06-10 | Entropy GC: 3 项清理 | .gitignore, docs/, ARCHITECTURE.md | PR1: .workspace/ gitignored + 清理; PR2: 骨架文档 TODO 清理; PR3: ARCHITECTURE.md File Map 同步 |
| 2026-06-10 | Quality Gate 修复: 3 项缺口 | test/, src/request.ts, docs/ | P0 think-tag-stripper 测试 + P1 backpressure 测试 + P2 checkBodySize 增强 |
| 2026-06-09 | 7-agent + 11-skill Harness Engineering 体系 | All | 从 6-agent 专用体系升级到通用 Harness Engineering 体系 |
| 2026-06-05 | Initial configuration (6 agents, 3 skills) | All | First harness built |
| 2026-06-07 | Full rebuild from scratch | All | Tightened agent descriptions, added `model-registry` skill |
| 2026-06-07 | Added `model-registry` skill | New skill | Source of truth for upstream model catalogs |
| 2026-06-08 | Full harness rebuild | All | Fixed stale docs, added pitfalls, re-verified catalog |
| 2026-06-09 | Full harness rebuild from scratch | All | Hybrid execution mode, sub-agent coordination |
| 2026-06-09 | Full harness rebuild from scratch | All | Tighter descriptions, sub-agent protocol cleanup, orchestrator Phase 0 context check, all SendMessage references removed, streamlined workflows |

## Commands

```bash
bun install            # Install dependencies
bun install --frozen-lockfile  # CI-style clean install (verifies lockfile)
bun test               # Run all tests (vitest) — 360 tests
bun run test:watch     # Watch mode
bun run server.ts      # Bun dev server (primary local dev, no wrangler dependency)
DEBUG=true bun run server.ts  # Bun dev server with verbose Responses API logging
bun run build:binary     # Build standalone binary (macOS)
bunx vercel deploy --prod  # Deploy to Vercel (alternative to Cloudflare)
```

**Deployment pipeline:** `.github/workflows/release.yml` uses `oven-sh/setup-bun@v1` — runs `bun install --frozen-lockfile`, `bun test`, then deploys to Cloudflare Workers (optional, needs `CF_API_TOKEN`) and Vercel (needs `VERCEL_TOKEN`).

**Local deployment (macOS):** Build a standalone binary with `bun run build:binary`, copy to `/usr/local/bin/` (用户目录无需 sudo，直接 `cp opencode-cowork-proxy /usr/local/bin/`), and manage via `launchctl` with the `ai.opencode.proxy` LaunchAgent (port 18787). Restart with new binary: `launchctl kickstart -k gui/$(id -u)/ai.opencode.proxy`. Check status: `launchctl print gui/$(id -u)/ai.opencode.proxy`.

**Vercel deployment (alternative to Cloudflare):** `api/[[...route]].ts` entry exports `app.fetch` directly (no `hono/vercel` adapter needed — it can cause builds to hang). Deploy with `bunx vercel deploy --prod`. Production URL: `https://opencode-cowork-proxy.vercel.app`. Useful when Cloudflare Workers' shared egress IPs trigger upstream rate limiting (429).

## High-Level Architecture

A bidirectional API translation proxy that sits between AI clients (Anthropic/Claude, OpenAI SDK) and upstream AI API providers (OpenCode Go, OpenCode Zen). Deployed as a Cloudflare Worker using Hono.

### Request Flow

Every request goes through: **Auth → Routing → Request Translation → Upstream Fetch → Response Translation → Client**

The three translation paths are:

```
Anthropic client → POST /v1/messages → translate Anthropic→OpenAI → OpenAI upstream
OpenAI client   → POST /v1/chat/completions → passthrough (or translate to Anthropic via x-upstream-format: anthropic)
OpenAI client   → POST /v1/responses → translate Responses→Chat Completions → OpenAI upstream
```

### Translation Layer

The core translation logic is organized into 9 pure functions, split by direction and phase across three format pairs:

| Phase | Anthropic→OpenAI | OpenAI→Anthropic | Responses↔Chat Completions |
|-------|-----------------|-----------------|---------------------------|
| Request | `translate/request/anthropic-to-openai.ts` | `translate/request/openai-to-anthropic.ts` | `translate/request/responses-to-chat-completions.ts` |
| Response | `translate/response/anthropic-to-openai.ts` | `translate/response/openai-to-anthropic.ts` | `translate/response/chat-completions-to-responses.ts` |
| Stream | `translate/stream/anthropic-to-openai.ts` | `translate/stream/openai-to-anthropic.ts` | `translate/stream/chat-completions-to-responses.ts` |

**Critical pattern:** All 9 translators are pure functions (no `fetch`, no side effects). They are tested by constructing input payloads and asserting output shapes. The `index.ts` router wires them together with the upstream fetch calls. The Responses API translators handle DeepSeek-specific quirks: `type:"reasoning"` items merge with the next assistant message, and `finish_reason:"insufficient_system_resource"` maps to `status:"incomplete"`. See `field-mapping` and `stream-debug` skills for full field/event reference.

### Routing (`src/index.ts` + `src/auth.ts` + `src/cache.ts`)

Three non-translator modules support the core logic:

- **`index.ts`** — The `routeConfig()` function parses URL path prefixes (`/go`, `/zen`, none) to determine upstream URL. It also handles model override (model ID in URL path) and **upstream-aware vision model selection** via `getVisionModel(upstream, requestedModel)` — if the requested model is already vision-capable on the target upstream, it is kept; otherwise the upstream's default vision model is forced (`qwen3.6-plus` for `/go`, `mimo-v2.5-free` for `/zen`).
- **`auth.ts`** — Pure functions: `extractApiKey()` (checks `X-Api-Key` or `Authorization: Bearer`), `validateApiKey()` (min 32 chars), `authErrorResponse()`.
- **`cache.ts`** — Token extraction functions handle the messy reality that different OpenAI-compatible providers report usage in different field shapes (`prompt_tokens`, `input_tokens`, `promptTokens`...). Uses a `tokenCount()` helper that tries multiple field paths and picks the first numeric value. The `extractUncachedInputTokens()` function subtracts cached tokens from input tokens to avoid double-counting when mapping OpenAI usage to Anthropic format.

### Entry Points

The project has three entry points for different deployment targets:

| Entry Point | Target | Runtime | Run Command |
|------------|--------|---------|-------------|
| `src/index.ts` | CF Workers, Vercel | Hono (Worker runtime) | — |
| `server.ts` | Bun standalone, dev | Bun built-in HTTP | `bun run server.ts` |
| `api/[[...route]].ts` | Vercel only | Hono (serverless) | — |

### Error Relay

When the upstream returns an error (`!res.ok`), `upstreamErrorResponse()` forwards the body text and relays these headers: `Content-Type`, `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`. The status code and body are passed through unchanged — no translation is attempted on error responses.

### Model Override Chain (application order, as implemented in src/index.ts)

1. **URL path segment** — e.g., `/go/deepseek-v4-pro/v1/messages` → overrides body model
   (applied first, so subsequent image detection sees the overridden model)
2. **Image detection** — `hasImages()` / `hasOpenAIImages()` / `hasResponsesImages()`
   returns true → `getVisionModel(upstream, requestedModel)`, which:
   - If the resolved model (after URL override) is already vision-capable on the routed upstream → **keeps it** (no override)
   - Otherwise → forces the upstream's default vision model (`qwen3.6-plus` for `/go`, `mimo-v2.5-free` for `/zen`)
   
   **Vision-aware logic:** Users who explicitly request `claude-sonnet-4-6` keep their model even with images. Users who request `deepseek-v4-flash` get force-routed to the default vision model.
3. **Body `model` field** — fallback (used when neither URL override nor image detection triggers)

**Critical ordering constraint (Responses API path):** Image detection runs **BEFORE** DeepSeek thinking injection. This prevents injecting a `{"type":"enabled"}` thinking param on a model that was force-changed to a non-DeepSeek model by image detection — that would cause an unsupported-parameter error.

The response translators preserve `originalModel` (the body model) even when the upstream was overridden, so the client sees the model name it sent.

## Testing Patterns

**Framework:** Vitest. Tests are in `test/*.test.ts`.

**Mocking strategy for integration tests** (`test/index.test.ts`):
```typescript
const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
  new Response(JSON.stringify({...}), { status: 200, headers: {...} }),
);
// After test:
vi.restoreAllMocks();
```

**Key patterns:**
- Integration tests use `worker.fetch(request)` to test routing end-to-end with mocked `fetch`
- Pure translator tests construct input payloads and assert output shapes (no mocks needed)
- Stream translator tests create mock `ReadableStream` from chunk arrays and collect output

## Common Pitfalls

1. **Streaming block lifecycle:** In OpenAI→Anthropic direction, every `content_block_start` must be followed by deltas + one `content_block_stop`. Switching between text/thinking/tool_use blocks requires a `content_block_stop` for the old type before `content_block_start` for the new type — the most common streaming bug.
2. **SSE format differences:** Anthropic uses `event: <type>\ndata: <json>\n\n`. OpenAI uses `data: <json>\n\n` (no event lines). Open AI streams must end with `data: [DONE]`.
3. **Usage token double-counting:** When mapping OpenAI usage to Anthropic, cached tokens are reported both inside `prompt_tokens` and separately in `prompt_tokens_details.cached_tokens`. The `extractUncachedInputTokens()` function subtracts to avoid double-count.
4. **Tool call argument accumulation:** In streaming, OpenAI sends tool call arguments incrementally across multiple chunks. The Anthropic→OpenAI translator concatenates them; the OpenAI→Anthropic translator handles accumulation per tool call index.
5. **Responses API tool calls in non-DeepSeek path:** `translateAssistantContent()` in `responses-to-chat-completions.ts` must call `extractToolCalls()` to handle embedded `tool_call` content blocks. The DeepSeek merge path does this; the plain assistant path used to silently drop them — a CRITICAL class bug. See `field-mapping` skill "Common Bug Patterns (Responses API)" for the full list.
6. **Bun vitest `vi.mocked` unavailable:** bun's vitest does not export `vi.mocked`. Use `globalThis.fetch` directly (or `(globalThis.fetch as any)` for TypeScript) in `toHaveBeenCalledWith` assertions.
7. **Inline `<think>` tags in content text:** Some models (e.g., Minimax) embed reasoning inside `<think>` tags within the response `content` field rather than using the standard `reasoning_content` field. Both `formatChatCompletionsToResponses()` and `streamChatCompletionsToResponses()` must strip these tags. The stream handler uses an `inThinkTag` state machine with `thinkTagBuffer` to handle tags split across SSE chunks.
8. **Vercel `build` script auto-detection:** Vercel's deploy step runs any script named `build` in package.json. Use `build:binary` (not `build`) for standalone binary compilation — otherwise Vercel will attempt a macOS binary build during deployment.
9. **Version source is `package.json` JSON import:** `src/version.ts` does `import pkg from '../package.json'` — this works across all 4 runtimes (Bun dev server, standalone binary, CF Workers/esbuild, Vercel). Never add runtime version detection (git rev-parse, env var fallbacks) that produces different values per target.
10. **Temp directory space:** The Claude Code tempfs (`/private/tmp/claude-*/`) can fill up with build artifacts. If commands fail with ENOSPC, set `TMPDIR=/tmp` or clear old temp dirs.
11. **Image detection before DeepSeek thinking injection (Responses API):** In `/v1/responses` handling, `hasResponsesImages()` + `getVisionModel()` runs **BEFORE** the auto-injection of `thinking: {type:"enabled"}` for deepseek-* models. This is deliberate: if image detection forces a model change to a non-DeepSeek model (e.g., `mimo-v2.5-free`), the thinking param must NOT be added. Reversing this order would inject unsupported params on the replaced model. Always check this ordering when adding a new model-specific feature to the Responses API handler.
12. **`VISION_CAPABLE_GO` / `VISION_CAPABLE_ZEN` sets drift from upstream reality:** These sets in `src/index.ts` must match what the upstream actually serves. When adding a new vision-capable model, update BOTH the source code AND the `model-registry` skill. If the upstream removes a model, remove it from both. A stale entry means `getVisionModel()` returns a model ID the upstream no longer recognizes, causing 404 errors. See `model-registry` skill for the full catalog and run `curl -s <upstream>/v1/models` to verify.

13. **Known fixes in `docs/FIXES.md`:** `<think>` tag stripping, `input_text` block recognition, Vercel adapter workaround, and model cache fallback are documented in `docs/FIXES.md`. Check this file before modifying related code to avoid reintroducing fixed bugs.

<!-- HARNESS-PILOT:START -->

## Harness: Harness Engineering

**Goal:** 为任意项目一键配置 AI agent 团队和 harness 体系

**Trigger:** 工作请求涉及 harness 配置、agent 团队搭建、知识库架构时，使用 `harness-orchestrator` skill。简单问题直接回答。

### 架构地图

- [AGENTS.md](AGENTS.md) — 项目主文档和 harness 指针
- Agent 定义：`.claude/agents/`（7 个）
- Skill 定义：`.claude/skills/`（11 个）
- 安装脚本：`scripts/install.mjs`

### 核心原则

1. **人类掌舵，智能体执行**
2. **仓库即记录系统**
3. **给地图，不给说明书**
4. **约束即加速器**
5. **渐进式披露**
6. **纠错成本低，等待成本高**
7. **Agent = Model + Harness** — 模型提供智能，Harness 让智能可用

<!-- HARNESS-PILOT:END -->
