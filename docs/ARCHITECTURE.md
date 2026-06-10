# Architecture: OpenCode Cowork Proxy

> **何时读此文件：** 理解项目的 6 层架构边界、L1-L5 依赖方向规则、品味不变量、和架构决策记录（ADR）。新增功能或重构时必读，确保代码遵守架构约束。

## Overview

A bidirectional API translation proxy serving as a bridge between AI clients (Anthropic/Claude, OpenAI SDK) and upstream AI API providers (OpenCode Go, OpenCode Zen). Deployed as a Cloudflare Worker using Hono, with Vercel and macOS standalone binary as alternative runtimes.

### Core Purpose

Translate between three API protocol pairs so clients and upstreams with different formats can interoperate without client-side changes:
- **Anthropic Messages API** (`/v1/messages`) <--> **OpenAI Chat Completions** (`/v1/chat/completions`)
- **OpenAI Responses API** (`/v1/responses`) --> **OpenAI Chat Completions** (one-directional)

---

## 1. Layered Architecture

```
Types/Constants         (config.ts, version.ts)
    |
    v
Utilities/Lib           (auth.ts, cache.ts, routing.ts, vision.ts)
    |
    v
Translation Layer       (translate/request/, translate/response/, translate/stream/)
    |                         ^
    |                         |
    v                         |
Request Utilities       (request.ts -- upstream fetch, auth, error relay, gzip)
    |
    v
Router/Entry            (index.ts -- Hono app, route dispatch, model override)
    |
    v
Deployment Entry Points (server.ts, api/[[...route]].ts)
```

### Layer Responsibilities

| Layer | Directory | Responsibility | Allowed Dependencies |
|-------|-----------|----------------|---------------------|
| **Constants** | `config.ts`, `version.ts` | Upstream URLs, vision model sets, TTL defaults, version string | `package.json` (version only) |
| **Utilities** | `auth.ts`, `cache.ts`, `routing.ts`, `vision.ts`, `backpressure.ts`, `think-tag-stripper.ts` | Pure functions: key extraction, token extraction, URL routing, image detection, stream backpressure, think tag stripping | Constants |
| **Translation** | `translate/request/`, `translate/response/`, `translate/stream/`, `translate/index.ts` (barrel) | 9 pure functions + barrel export: format conversion between Anthropic, OpenAI Chat, and OpenAI Responses APIs | `cache.ts` (for `hashSystemPrompt`, `mapUsage`), `think-tag-stripper.ts`, `backpressure.ts` |
| **Request Utilities** | `request.ts` | Upstream fetch, auth orchestration, error relay, streaming signal, gzip compression, JSON response construction | Utilities |
| **Router** | `index.ts`, `request-handlers.ts` | Hono app definition, CORS, route dispatch, model override chain, upstream routing, route-specific handler functions | All layers |
| **Entry Points** | `server.ts`, `api/[[...route]].ts` | Runtime-specific bootstrap (Bun serve, Vercel serverless) | Router (`index.ts`) |

### Strict Dependency Direction

Dependencies flow **downward only** -- a layer may import from any layer below it, but never from a layer above it.

- Router (`index.ts`) is the sole orchestrator -- it imports from all lower layers and wires them together.
- Translation functions import ONLY from `cache.ts` (utility layer). They NEVER import from `request.ts` or `index.ts`.
- No module imports from `server.ts` or `api/` (deployment entry points are consumers only).

---

## 2. Data Flow Paths

### Path A: Anthropic Client --> OpenAI Upstream

```
Anthropic Client
  POST /v1/messages
      |
      v
index.ts: routeConfig() -- parses URL prefix (/go, /zen) for upstream selection
      |
      v
auth.ts: extractApiKey() + validateApiKey()
      |
      v
index.ts: model override chain
  |-- route.modelOverride (URL path segment) -> req.model
  |-- hasImages() -> getVisionModel() -> req.model (image detection)
      |
      v
translate/request/anthropic-to-openai.ts: formatAnthropicToOpenAI()
  |-- maps Anthropic message structure -> OpenAI messages
  |-- handles: system, image blocks (url/base64 -> image_url), tools, thinking
  |-- injects prompt cache key via hashSystemPrompt()
      |
      v
request.ts: safeUpstreamFetch() to {upstream}/v1/chat/completions
      |
      +-- [non-streaming path] -----------------------+
      |                                                 |
      v                                                 v
  translate/response/openai-to-anthropic.ts:        translate/stream/openai-to-anthropic.ts:
  toAnthropicResponse()                             streamOpenAIToAnthropic()
  |-- OpenAI usage -> Anthropic usage format        |-- SSE event mapping
  |-- finish_reason mapping                         |-- content_block_start/delta/stop lifecycle
  |-- originalModel preserved                       |-- tool call accumulation
      |                                                 |
      v                                                 v
  index.ts: jsonResponse() (optional gzip)          index.ts: new Response(ReadableStream, SSE headers)
      |                                                 |
      v                                                 v
  Anthropic Client <---                             Anthropic Client <--- SSE stream
```

### Path B: OpenAI Client --> Anthropic Upstream (with `X-Upstream-Format: anthropic`)

```
OpenAI Client
  POST /v1/chat/completions  (with header X-Upstream-Format: anthropic)
      |
      v
index.ts: routeConfig() -- standard URL parsing
      |
      v
auth.ts: extractApiKey() + validateApiKey()
      |
      v
index.ts: upstreamFormat() -- detects "anthropic" header -> translation path
      |
      v
index.ts: model override chain
  |-- route.modelOverride -> req.model
  |-- hasOpenAIImages() -> getVisionModel() -> req.model
      |
      v
translate/request/openai-to-anthropic.ts: formatOpenAIToAnthropic()
  |-- messages -> Anthropic content blocks
  |-- tool_calls -> tool_use blocks
  |-- image_url -> base64 image blocks
      |
      v
request.ts: safeUpstreamFetch() to {upstream}/v1/messages
      |
      +-- [non-streaming path] -----------------------+
      |                                                 |
      v                                                 v
  translate/response/anthropic-to-openai.ts:         translate/stream/anthropic-to-openai.ts:
  toOpenAIResponse()                                 streamAnthropicToOpenAI()
  |-- Anthropic content -> OpenAI choices            |-- SSE event mapping
  |-- tool_use -> tool_calls                         |-- content_block -> delta accumulation
  |-- originalModel preserved                        |-- tool_call index tracking
      |                                                 |
      v                                                 v
  index.ts: jsonResponse()                           index.ts: new Response(ReadableStream, SSE headers)
      |                                                 |
      v                                                 v
  OpenAI Client <---                                 OpenAI Client <--- SSE stream
```

### Path C: OpenAI Responses API --> Chat Completions Upstream

```
OpenAI Client (SDK or direct)
  POST /v1/responses
      |
      v
index.ts: routeConfig() -- standard URL parsing
      |
      v
auth.ts: extractApiKey() + validateApiKey()
      |
      v
index.ts: model override chain (CRITICAL ORDERING)
  1. route.modelOverride -> req.model
  2. hasResponsesImages() -> getVisionModel() -> req.model (BEFORE thinking injection)
  3. DeepSeek auto-inject: if model starts with "deepseek-" and no thinking -> thinking={type:"enabled"}
      |
      v
translate/request/responses-to-chat-completions.ts: formatResponsesToChatCompletions()
  |-- input items (message, reasoning, tool_call) -> messages array
  |-- prior_response_id -> conversation history injection
  |-- tool definitions pass-through
  |-- thinking -> max_tokens mapping
  |-- DeepSeek merge: type:"reasoning" items merge with next assistant message
      |
      v
request.ts: safeUpstreamFetch() to {upstream}/v1/chat/completions
      |
      +-- [non-streaming path] -----------------------+
      |                                                 |
      v                                                 v
  translate/response/chat-completions-to-responses.ts:  translate/stream/chat-completions-to-responses.ts:
  formatChatCompletionsToResponses()                    streamChatCompletionsToResponses()
  |-- choices[0].message -> output items               |-- SSE event mapping
  |-- reasoning_content -> type:"reasoning" output      |-- <think> tag stripping (state machine)
  |-- tool_calls -> function_call output items          |-- delta accumulation
  |-- mapUsage() for token mapping                      |-- finish_reason -> status mapping
  |-- <think> tag stripping                             |-- DeepSeek specific handling
  |-- originalModel preserved                           |-- insufficient_system_resource handling
      |                                                 |
      v                                                 v
  index.ts: jsonResponse()                           index.ts: new Response(ReadableStream, SSE headers)
      |                                                 |
      v                                                 v
  OpenAI Client <---                                  OpenAI Client <--- SSE stream
```

### Metadata: Model Discovery

```
Client
  GET /v1/models
      |
      v
index.ts: auth check
      |
      v
index.ts: Cloudflare Cache API lookup (300s TTL, keyed by upstream + format)
      |
      +-- [cache HIT] --> return cached response
      |
      +-- [cache MISS]
            |
            v
          safeUpstreamFetch() to {upstream}/v1/models
            |
            v
          index.ts: wrap in Cache-Control: public, max-age=300 response
            |
            v
          fire-and-forget: caches.default.put(cacheRequest, response.clone())
            |
            v
          Client <--- response
```

### Metadata: Health Check (no auth)

```
GET / -> { name, version, status, uptime, upstream, routes, endpoints }
```

---

## 3. Module Dependency Graph

```
package.json
    |
    v
src/version.ts
    |
    v
src/config.ts  <------------------------------------------+
    |                                                     |
    +---> src/routing.ts                                  |
    |         |                                           |
    +---> src/vision.ts                                   |
    |         |                                           |
    +---> src/auth.ts                                     |
    |                                                     |
    v                                                     |
src/cache.ts <-------------------------------------------+
    |
    +---> translate/request/anthropic-to-openai.ts
    +---> translate/request/openai-to-anthropic.ts
    +---> translate/request/responses-to-chat-completions.ts
    +---> translate/response/anthropic-to-openai.ts
    +---> translate/response/openai-to-anthropic.ts
    +---> translate/response/chat-completions-to-responses.ts
    +---> translate/stream/anthropic-to-openai.ts
    +---> translate/stream/openai-to-anthropic.ts
    +---> translate/stream/chat-completions-to-responses.ts
    |
src/auth.ts
    |
    +---> src/request.ts (authenticateRequest, authErrorResponse via auth.ts)
    |
src/routing.ts  src/vision.ts  src/cache.ts
    |
    +---> src/request.ts
    |
src/translate/**/*.ts  (9 pure functions)
    |
    +---> src/request.ts  (NOT USED -- translate modules import ONLY from cache.ts)
    |
src/request.ts  (combined auth + upstream fetch + utilities)
    |    imports: auth.ts, config.ts
    |
src/index.ts  (Hono app, single handleRequest() function)
    |    imports: all translate modules, config, routing, vision, auth, request, version
    |
    +---> server.ts  (Bun dev + standalone binary)
    |
    +---> api/[[...route]].ts  (Vercel serverless)
```

### Key Architectural Invariants

1. **No circular dependencies.** Every import chain traces downward through the layer stack.
2. **Translate modules never import request.ts.** They are pure function libraries with no side effects.
3. **request.ts is a singleton module.** It combines auth orchestration, upstream fetch, error relay, streaming signal management, gzip compression, and JSON response construction -- all coordinated in one place to avoid cross-module coupling.
4. **index.ts is the only orchestrator.** No other file handles routing logic, model override chaining, or phase coordination.

---

## 4. Architecture Constraint Rules

### 4.1 Layer Boundaries

| Rule | Description | Severity |
|------|-------------|----------|
| L1 | Translate modules must NOT import from `request.ts`, `index.ts`, or any deployment entry point | error |
| L2 | `request.ts` must NOT import from any translate module | error |
| L3 | `routing.ts`, `auth.ts`, `vision.ts` must NOT import from `translate/`, `request.ts`, or `index.ts` | error |
| L4 | `index.ts` is the ONLY module that wires translate functions together with request.ts utilities | warning |
| L5 | Deployment entry points (`server.ts`, `api/`) must ONLY import `index.ts` | error |

### 4.2 Module Structure

| Rule | Description | Severity |
|------|-------------|----------|
| M1 | Each translate function must be a named export matching the pattern `format{Source}To{Target}` or `stream{Source}To{Target}` | warning |
| M2 | Translation modules must be in the 3-subdirectory structure: `request/`, `response/`, `stream/`. Barrel (`index.ts`) and utility modules belong at `translate/` root or `src/` level | error |
| M3 | No file in `src/` may exceed 500 lines | warning |
| M4 | No file in `src/` may have more than 10 imports | warning |

### 4.3 Data Flow

| Rule | Description | Severity |
|------|-------------|----------|
| D1 | Every translation phase (request, response, stream) must be a pure function -- no fetch, no I/O, no side effects | error |
| D2 | Stream translation must accept `ReadableStream` and return `ReadableStream` | error |
| D3 | Error responses from upstream must pass through untranslated via `upstreamErrorResponse()` | error |
| D4 | Non-streaming upstream errors must never be fed through response translators | error |

### 4.4 Naming Conventions

| Rule | Convention | Example |
|------|-----------|---------|
| N1 | Request translator: `format{Source}To{Target}` | `formatAnthropicToOpenAI` |
| N2 | Response translator: `format{Source}To{Target}` | `formatChatCompletionsToResponses` |
| N3 | Stream translator: `stream{Source}To{Target}` | `streamOpenAIToAnthropic` |
| N4 | Translation files: `{source}-to-{target}.ts` | `anthropic-to-openai.ts` |

---

## 5. Deployment Architecture

### 5.1 Cloudflare Workers (Primary)

```
                    Cloudflare Edge Network
                    =======================
                    wrangler.toml config
                           |
                    Hono app (index.ts)
                           |
               src/index.ts -- app.fetch()
               /        |        \
              /         |         \
    CF Cache API    Upstream    Response
    (model list)    (fetch)     (streaming)
                           |
              +------------+------------+
              |                         |
      OpenCode Go               OpenCode Zen
   (opencode.ai/zen/go)       (opencode.ai/zen)
```

- **Entry point:** `src/index.ts` exports `default app` (Hono instance)
- **Build:** `wrangler deploy` bundles with esbuild
- **Cache:** Cloudflare Cache API for model list (300s TTL)
- **Limitation:** Shared CF egress IPs can trigger upstream rate limiting

### 5.2 Vercel (Alternative)

```
                    Vercel Edge/Serverless
                    ======================
                    vercel.json config
                           |
               api/[[...route]].ts -- app.fetch
                           |
                  src/index.ts (Hono)
                           |
                     Upstream fetch
```

- **Entry point:** `api/[[...route]].ts` exports `app.fetch` directly
- **Build:** `bunx vercel deploy --prod`
- **Advantage:** Different egress IP range avoids CF Workers' rate limiting issues
- **Constraint:** Must NOT use `hono/vercel` adapter -- it causes builds to hang

### 5.3 macOS Standalone Binary

```
                    macOS Binary
                    ============
                    Bun-compiled binary
                           |
                    server.ts -- Bun.serve()
                           |
                  src/index.ts (Hono)
                           |
                     Upstream fetch
```

- **Entry point:** `server.ts` imports `index.ts` and wraps with `Bun.serve()`
- **Build:** `bun run build:binary` produces standalone executable
- **Process management:** LaunchAgent (`ai.opencode.proxy`) on port 18787
- **Development:** `bun run dev` uses `wrangler dev`; `bun run server.ts` uses Bun's HTTP server

### 5.4 Test Architecture

```
                    Vitest
                    ======
                    test/*.test.ts
                    
    Pure function tests:           Integration tests:
    -------------------           -------------------
    anthropic-to-openai ->        index.test.ts
      construct input,              worker.fetch() with
      assert output shape           mocked globalThis.fetch
                                    |
    openai-to-anthropic ->          assert routing +
      same pattern                  translation pipeline
    
    responses.test.ts ->
      Responses API shaping

    cache.test.ts ->
      token extraction              
    
    stream.test.ts ->
      mock ReadableStream from chunk arrays
```

### 5.5 CI/CD Pipeline

```
GitHub Actions (release.yml)
    |
    v
oven-sh/setup-bun@v1
    |
    v
bun install --frozen-lockfile
    |
    v
bun test
    |
    v
Cloudflare Workers deploy (optional, needs CF_API_TOKEN)
    |
    v
Vercel deploy (optional, needs VERCEL_TOKEN)
```

---

## 6. Taste Invariants (Coding Standards)

### 6.1 Functional Style

| Invariant | Description | Enforcement |
|-----------|-------------|-------------|
| **Pure translation** | All 9 translate functions are pure: same input always produces same output, no I/O, no side effects | Code review |
| **Type-safe parsing at boundaries** | Parse and validate data at the system boundary (request body parse, upstream response parse). Never validate deep inside translation logic | Code review |
| **No mutation of inputs** | Translate functions must not mutate input objects (use spread/object assign for copies) | Code review |

### 6.2 Error Handling

| Invariant | Description | Enforcement |
|-----------|-------------|-------------|
| **Error pass-through** | Upstream errors are relayed as-is -- no format translation attempted | Code review, integration tests |
| **Safe JSON parse** | All `request.json()` calls wrapped in try/catch via `safeJsonBody()` | Static analysis |
| **Safe upstream fetch** | All `fetch()` calls wrapped via `safeUpstreamFetch()` | Static analysis |

### 6.3 Streaming

| Invariant | Description | Enforcement |
|-----------|-------------|-------------|
| **Content block lifecycle** | Every `content_block_start` must be followed by delta(s) + one `content_block_stop` | Integration tests |
| **SSE termination** | OpenAI SSE streams must end with `data: [DONE]` | Integration tests |
| **Abort propagation** | Client disconnect must abort upstream fetch (via `createStreamSignal()`) | Manual review |

### 6.4 Model Override

| Invariant | Description | Enforcement |
|-----------|-------------|-------------|
| **Ordering: override -> vision -> thinking** | URL model override applied first, then vision detection, then DeepSeek thinking injection | Code review, integration tests |
| **Vision before thinking (Responses API)** | `hasResponsesImages()` + `getVisionModel()` must run BEFORE DeepSeek `thinking` auto-inject. Reversing this would inject unsupported params on the replaced model | Code review, integration tests |
| **originalModel preservation** | Response translators receive and preserve the original request model name, even when upstream was overridden | Integration tests |

### 6.5 Cache / Token Handling

| Invariant | Description | Enforcement |
|-----------|-------------|-------------|
| **Subtract cached tokens** | When mapping OpenAI-style usage (prompt_tokens includes cached) to Anthropic format, use `extractUncachedInputTokens()` to avoid double-counting | Unit tests, code review |
| **Do NOT subtract on Anthropic format** | `extractUncachedInputTokens()` must NOT be called on pure Anthropic-style usage where input_tokens and cache_read_input_tokens are already separate | Code review |
| **Multi-provider token fields** | `extractCachedTokens()` and `extractInputTokens()` must try multiple field names to handle provider-specific shapes (OpenAI, DeepSeek, Anthropic) | Unit tests |

### 6.6 Configuration

| Invariant | Description | Enforcement |
|-----------|-------------|-------------|
| **Single version source** | Version comes from `package.json` only (via JSON import in `version.ts`) -- no runtime git/hash/env fallbacks | Code review |
| **Upstream URL constants** | Upstream URLs are constants in `config.ts`, not hardcoded in translation or routing logic | Code review |
| **Vision model sets must match upstream** | `VISION_CAPABLE_GO` and `VISION_CAPABLE_ZEN` in `config.ts` must be verified against upstream model catalogs. Stale entries cause 404 errors | Manual (run `curl -s <upstream>/v1/models`) |

---

## 7. File Map

```
src/
  index.ts              Router/Hono app (dispatches to request-handlers.ts)
  request-handlers.ts   Route-specific handlers (5 handlers: Anthropic, OpenAI, Responses, Models, Health)
  auth.ts               API key extraction, validation, error formatting
  backpressure.ts       Stream backpressure helper (adaptive microtask delay)
  cache.ts              Token extraction, usage mapping, prompt cache hash
  config.ts             Upstream URLs, vision model sets, constants
  request.ts            Upstream fetch, auth orchestration, error relay, gzip, JSON response
  routing.ts            URL prefix parsing, model segment extraction, upstream resolution
  think-tag-stripper.ts  Think tag stripping (non-streaming function + streaming state machine)
  version.ts            Package version import (cross-runtime compatible)
  vision.ts             Image detection per format, vision model selection
  translate/
    index.ts              Barrel export — all 9 translation functions
    request/
      anthropic-to-openai.ts          Request: Anthropic Messages --> OpenAI Chat Completions
      openai-to-anthropic.ts          Request: OpenAI Chat --> Anthropic Messages
      responses-to-chat-completions.ts  Request: OpenAI Responses --> Chat Completions
    response/
      anthropic-to-openai.ts          Response: Anthropic Messages --> OpenAI Chat (non-stream)
      openai-to-anthropic.ts          Response: OpenAI Chat --> Anthropic Messages (non-stream)
      chat-completions-to-responses.ts  Response: Chat Completions --> OpenAI Responses (non-stream)
    stream/
      anthropic-to-openai.ts          Stream: Anthropic SSE --> OpenAI SSE
      openai-to-anthropic.ts          Stream: OpenAI SSE --> Anthropic SSE
      chat-completions-to-responses.ts  Stream: Chat Completions SSE --> Responses SSE

test/
  index.test.ts             Integration tests (mock fetch, end-to-end pipeline)
  auth.test.ts              Auth unit tests
  cache.test.ts             Cache/token extraction tests
  request.test.ts           Request translation format tests
  response.test.ts          Response translation format tests
  responses.test.ts         Responses API translation tests
  routing.test.ts           Routing logic tests
  stream.test.ts            Stream translation tests (mock ReadableStream)
  utils.test.ts             Vision/cache utility tests
  vision.test.ts            Vision detection tests
  think-tag-stripper.test.ts  Think tag stripping tests (non-streaming + streaming state machine)
  backpressure.test.ts        Stream backpressure tests (adaptive delay per desiredSize)

server.ts                 Bun dev server + standalone binary entry point
api/[[...route]].ts       Vercel serverless entry point (wraps app.fetch)
```

---

## 8. Architectural Decision Records (Key Design Choices)

### ADR-1: Single Router Function Over Hono Middleware Chain

**Decision:** `handleRequest()` is a single monolithic function in `index.ts` with three distinct translation branches, rather than a Hono middleware chain.

**Rationale:** The per-request routing is highly conditional (3 API formats x 2 streaming modes x model override x image detection x upstream selection). A middleware chain would require complex state passing and premature body reads. A single function keeps the branching logic visible and testable via `worker.fetch()` with mocked `fetch`.

**Trade-off:** Readability suffers at 413 lines. Mitigated by clear section headers and the 9 pure translation functions that handle the complexity.

### ADR-2: 9 Separate Pure Functions Over a Strategy Pattern

**Decision:** Each translation direction/phase is a standalone exported function, not a class hierarchy or strategy interface.

**Rationale:** Each translator has unique input/output shapes and quirks (DeepSeek thinking, Responses API input format, Anthropic content block lifecycle). A shared interface would be too abstract to capture these differences, leading to type casting and conditionals.

### ADR-3: request.ts as Combined Singleton

**Decision:** `request.ts` combines auth orchestration, upstream fetch, error relay, streaming signal, gzip, and JSON response in one module.

**Rationale:** These concerns are tightly coupled in usage -- `index.ts` needs all of them at every branch point. Splitting them would increase import surface and require cross-module coordination for features like gzip compression or header forwarding.

### ADR-4: Error Pass-Through Without Translation

**Decision:** When upstream returns a non-2xx response, the proxy forwards the body and status code unchanged.

**Rationale:** Error shapes vary between upstreams and over time. Translating errors would require maintaining error schema knowledge for each provider, which is brittle and offers no client benefit (API clients must handle provider-specific errors already).

### ADR-5: Version from package.json Only

**Decision:** `version.ts` imports from `package.json` with zero fallback logic.

**Rationale:** Works across all 4 runtimes (Bun dev, standalone binary, CF Workers/esbuild, Vercel). Adding git/hash/env fallbacks would produce different version strings per target, making debugging harder.
