# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🏗️ Harness: OpenCode Cowork Proxy

**Goal:** Anthropic↔OpenAI and OpenAI Responses API translation gateway (Hono app, deployable to Cloudflare Workers, Vercel, or macOS standalone binary).

**Trigger:** For proxy-related work (translation bugs, streaming issues, routing changes, model updates, code review, deployment, testing, performance audit, investigation-only diagnosis), invoke the `proxy-orchestrator` skill. Specialized skills: `field-mapping` (Anthropic↔OpenAI/Responses field reference), `stream-debug` (SSE streaming diagnosis), `deployment` (CF/Vercel/binary + LaunchAgent + CI/CD), `model-registry` (which models exist on which upstream + vision model selection). Simple questions can be answered directly.

**Agent Team (6 members):** `translation-specialist`, `streaming-specialist`, `routing-specialist`, `qa-inspector`, `code-reviewer`, `deployment-manager` — definitions in `.claude/agents/`. Orchestration rules + workflows in `.claude/skills/proxy-orchestrator/SKILL.md`. All Agent calls use `model: "opus"`.

**Harness Change History:**

| Date | Change | Target | Reason |
|------|--------|--------|--------|
| 2026-06-05 | Initial configuration (6 agents, 3 skills) | All | First harness built |
| 2026-06-07 | Full rebuild from scratch | All | Tightened agent descriptions, added `model-registry` skill (addresses vision-model hardcoding bug class), unified SKILL.md format, added follow-up keywords, added performance-audit workflow |
| 2026-06-07 | Added `model-registry` skill | New skill | Source of truth for upstream model catalogs + vision model selection rules; prevents regression of the `VISION_MODEL` hardcoding bug fixed in commit 3b5743b |
| 2026-06-07 | Vision-aware model override | `src/index.ts` + 5 new tests | Image-bearing requests no longer force-override when the resolved model (URL path or body) is already vision-capable on the routed upstream. See `VISION_CAPABLE_GO` / `VISION_CAPABLE_ZEN` Sets and updated `getVisionModel(upstream, requestedModel)` signature. `model-registry` skill and `routing-specialist` agent updated. |
| 2026-06-08 | Full harness rebuild | All | Fixed stale model override chain docs (still described unconditional forcing), updated notable recent changes, added pitfall #11 (image-detection-before-thinking ordering) and #12 (VISION_CAPABLE set drift), re-verified model catalog, tightened agent/skill consistency |
| 2026-06-09 | Harness drift fix | model-registry, agents, CLAUDE.md | Removed orphaned code block in model-registry, tightened agent descriptions, aligned team communication sections with sub-agent execution mode, updated change history |
| 2026-06-09 | Full harness rebuild from scratch | All | Deleted all old agents/skills, rebuilt 6 agents + 5 skills from scratch. Hybrid execution mode (fan-out/fan-in for diagnosis, single sub-agents for review/QA). Removed all SendMessage dependencies. Added pitfall #11 (image-detection-before-thinking ordering) and #12 (VISION_CAPABLE set drift). Updated model catalog to reflect 2026-06-08 upstream reality. |

**Notable recent changes:** See the Harness Change History table above for all June 7 updates. Earlier changes (June 5): Version bumped to 2.0.0. Added Minimax `<think>` tag stripping in response/stream translators (with cross-chunk stream buffer handling), `input_text` content block support in Responses API request translation, and expanded Responses API debug logging. Vercel deployment target added (solves CF Workers 429 rate limiting), CI/CD switched from npm to bun (requires `CF_API_TOKEN` + `VERCEL_TOKEN` GitHub secrets), belt-and-suspenders image detection on pass-through paths, 15 routing + 8 translation bug fixes, 24 regression tests added, dev branch workflow (PR triggers test only, merge triggers full deploy), harness skills updated to reflect bun+Vercel. See `_workspace_archive/` for full change history.

## Commands

```bash
bun install            # Install dependencies
bun install --frozen-lockfile  # CI-style clean install (verifies lockfile)
bun test               # Run all tests (vitest)
bun run test:watch     # Watch mode
bun run dev            # wrangler dev (CF Workers runtime)
DEBUG=true bun run server.ts  # Bun dev server with verbose Responses API logging
bun run build:binary     # Build standalone binary (macOS)
bun run deploy         # wrangler deploy to Cloudflare (config: wrangler.toml)
bunx vercel deploy --prod  # Deploy to Vercel (alternative to Cloudflare)
```

**Deployment pipeline:** `.github/workflows/release.yml` uses `oven-sh/setup-bun@v1` — runs `bun install --frozen-lockfile`, `bun test`, then deploys to Cloudflare Workers (optional, needs `CF_API_TOKEN`) and Vercel (needs `VERCEL_TOKEN`).

**Local deployment (macOS):** Build a standalone binary with `bun run build:binary`, copy to `/usr/local/bin/`, and manage via `launchctl` with the `ai.opencode.proxy` LaunchAgent (port 18787). Check status: `launchctl print gui/$(id -u)/ai.opencode.proxy`.

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
