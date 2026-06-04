# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🏗️ Harness: OpenCode Cowork Proxy

**Goal:** Anthropic↔OpenAI and OpenAI Responses API translation gateway (Cloudflare Worker using Hono).

**Trigger:** For proxy-related work (translation bugs, streaming issues, routing changes, model updates, code review, deployment, testing), invoke the `proxy-orchestrator` skill. Specialized skills also available: `deployment` (build, CI/CD, LaunchAgent, Cloudflare deploy), `field-mapping` (Anthropic↔OpenAI field reference for translation work), `stream-debug` (SSE streaming diagnosis). Simple questions can be answered directly.

**Agent Team (6 members):** `translation-specialist`, `streaming-specialist`, `routing-specialist`, `qa-inspector`, `code-reviewer`, `deployment-manager` — definitions in `.claude/agents/`. Orchestration rules in `skills/proxy-orchestrator/SKILL.md`.

**Change History:**
| Date | Change | Target | Reason |
|------|--------|--------|--------|
| 2026-06-04 | Initial harness setup | All | New build for proxy project |
| 2026-06-04 | Added translation-specialist | agents/translation-specialist.md | Request/response field mapping between Anthropic and OpenAI formats |
| 2026-06-04 | Added streaming-specialist | agents/streaming-specialist.md | SSE event sequencing for both translation directions |
| 2026-06-04 | Added routing-specialist | agents/routing-specialist.md | Path routing, model override, auth, cache, deployment config |
| 2026-06-04 | Added qa-inspector | agents/qa-inspector.md | Cross-boundary integration verification (catches boundary mismatches) |
| 2026-06-04 | Added code-reviewer | agents/code-reviewer.md | Static review for correctness, security, type safety |
| 2026-06-04 | Added deployment-manager | agents/deployment-manager.md | Dedicated build/deploy/CI/CD management |
| 2026-06-04 | Added field-mapping skill | skills/field-mapping/SKILL.md | Authoritative field-by-field reference for translation work |
| 2026-06-04 | Added stream-debug skill | skills/stream-debug/SKILL.md | SSE streaming diagnostic guide with common pitfalls |
| 2026-06-04 | Added deployment skill | skills/deployment/SKILL.md | Step-by-step deploy, config, model mgmt reference |
| 2026-06-04 | Updated proxy-orchestrator | skills/proxy-orchestrator/SKILL.md | Include new agents, add review/deploy workflows, update to sub-agent pattern |
| 2026-06-04 | Reconciled CLAUDE.md drift | CLAUDE.md | Audit found 4 agents + 2 skills unaccounted for in change history; trigger rules now list all 4 skills |
| 2026-06-04 | Fixed orchestrator Phase 2 mode | skills/proxy-orchestrator/SKILL.md | Execution-mode table said "Agent Team" but body correctly said "Sub-agents" — body is authoritative; table now matches |
| 2026-06-04 | Archived stale _workspace/ to _workspace_archive/2026-06-04-responses-api-fixes/ | skills/proxy-orchestrator | Preserved audit trail from `f010dfd` bug-fix run; future runs start clean |
| 2026-06-04 | Extended translation-specialist for Responses API | agents/translation-specialist.md | Translation of `/v1/responses` ↔ `/chat/completions` (input as string or array, reasoning merging, function_call_output, input_image) was undocumented; CRITICAL bug class (tool calls dropped) had no agent ownership |
| 2026-06-04 | Extended streaming-specialist for Responses API SSE | agents/streaming-specialist.md | Responses API uses a different event vocabulary (response.created/output_item.added/text.delta/reasoning_text.delta/function_call_arguments.delta/output_item.done/completed); no agent owned the streamChatCompletionsToResponses file |
| 2026-06-04 | Added Responses API field mapping to field-mapping skill | skills/field-mapping/SKILL.md | New tables for Responses API request/response mappings + 6-item Common Bug Patterns section |
| 2026-06-04 | Added Responses API streaming to stream-debug skill | skills/stream-debug/SKILL.md | New section: event type vocabulary, stream translation reference, tool call lifecycle, 6 known pitfalls |
| 2026-06-04 | Updated CLAUDE.md architecture for Responses API | CLAUDE.md | Translation Layer table now 3 columns × 3 rows = 9 translators; added 5th Common Pitfall; request flow diagram shows 3 paths |
| 2026-06-04 | Filled orchestrator workflow gaps | skills/proxy-orchestrator/SKILL.md | Added `model: opus` reminder, Investigate Only workflow, Performance audit workflow, explicit Add New Model workflow |

## Commands

```bash
npm install            # Install dependencies
npm test               # Run all tests (vitest)
npm run test:watch     # Watch mode
npm run dev            # wrangler dev (CF Workers runtime)
bun run server.ts      # Bun dev server (port 8787, no CF runtime)
bun build --compile --outfile opencode-cowork-proxy server.ts  # Build standalone binary
npm run deploy         # wrangler deploy to Cloudflare (config: wrangler.toml)
npx vercel deploy --prod  # Deploy to Vercel (alternative to Cloudflare)
```

**Deployment pipeline:** `.github/workflows/release.yml` triggers `wrangler deploy` on push to main. Manual deploy: `npm run deploy`.

**Local deployment (macOS):** Build a standalone binary with `bun build --compile --outfile opencode-cowork-proxy server.ts`, copy to `/usr/local/bin/`, and manage via `launchctl` with the `ai.opencode.proxy` LaunchAgent (port 18787).

**Vercel deployment (alternative to Cloudflare):** `api/[[...route]].ts` entry exports `app.fetch` directly (no `hono/vercel` adapter needed — it can cause builds to hang). Deploy with `npx vercel deploy --prod`. Production URL: `https://opencode-cowork-proxy.vercel.app`. Useful when Cloudflare Workers' shared egress IPs trigger upstream rate limiting (429).

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

- **`index.ts`** — The `routeConfig()` function parses URL path prefixes (`/go`, `/zen`, none) to determine upstream URL. It also handles model override (model ID in URL path) and vision model forcing (`qwen3.6-plus` when images detected).
- **`auth.ts`** — Pure functions: `extractApiKey()` (checks `X-Api-Key` or `Authorization: Bearer`), `validateApiKey()` (min 32 chars), `authErrorResponse()`.
- **`cache.ts`** — Token extraction functions handle the messy reality that different OpenAI-compatible providers report usage in different field shapes (`prompt_tokens`, `input_tokens`, `promptTokens`...). Uses a `tokenCount()` helper that tries multiple field paths and picks the first numeric value. The `extractUncachedInputTokens()` function subtracts cached tokens from input tokens to avoid double-counting when mapping OpenAI usage to Anthropic format.

### Error Relay

When the upstream returns an error (`!res.ok`), `upstreamErrorResponse()` forwards the body text and relays these headers: `Content-Type`, `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`. The status code and body are passed through unchanged — no translation is attempted on error responses.

### Model Override Chain (priority order, highest first)

1. **Image detection** — `hasImages()` / `hasOpenAIImages()` / `hasResponsesImages()`
   returns true → forces `qwen3.6-plus` (must route to vision-capable model)
2. **URL path segment** — e.g., `/go/deepseek-v4-pro/v1/messages` → overrides body model
3. **Body `model` field** — fallback

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
