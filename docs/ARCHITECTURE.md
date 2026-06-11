# Architecture: opencode-cowork-proxy

> Bidirectional AI API translation gateway -- Anthropic <-> OpenAI format bridge.
> Deployed on Cloudflare Workers, also supported on Bun standalone and Vercel.

## Table of Contents

1. [Layer Architecture](#1-layer-architecture)
2. [Module Dependency Map](#2-module-dependency-map)
3. [API Translation Flows](#3-api-translation-flows)
4. [Deployment Architecture](#4-deployment-architecture)
5. [Key Design Decisions (ADRs)](#5-key-design-decisions-adrs)
6. [Constraint Rules](#6-constraint-rules)
7. [Project File Inventory](#7-project-file-inventory)

---

## 1. Layer Architecture

### Layer Stack

```
+--------------------+
|   Entry Point      |  index.ts, server.ts (Bun), Vercel serverless
+--------------------+
         |  imports only from index.ts (barrier)
+--------------------+
|   Router           |  routing.ts - URL prefix parsing, upstream resolution
+--------+-----------+
         |
+--------+-----------+
|   Handlers         |  5 handlers: messages, chat-completions, responses,
|                    |  models, health
+--------+-----------+
         |
+--------+-----------+
|   Translate        |  9 pure format translators (request/response/stream)
+--------+-----------+
         |
+--------+-----------+
|   Request Util     |  request.ts - auth, fetch, body check, streaming signal
+--------+-----------+
         |
+--------+-------------------------------+
|   Utilities        |  auth, vision, cache, backpressure,
|                    |  think-tag-stripper, type-guards
+--------------------+
         |
+--------------------+
|   Config           |  config.ts - upstream URLs, vision sets, timeouts
+--------------------+
```

### Dependency Direction

Strictly unidirectional: Config -> Utilities -> Request Util -> Translate -> Handlers -> Router -> Entry.

**Critical invariants enforced by tests:**

```
Config Layer:     config.ts              (no imports from src/)
Utilities:        auth, vision, cache,    (no imports from translate/, request/, handlers/)
                  backpressure, type-guards
Request Util:     request.ts              (no imports from translate/ or handlers/)
Translate Layer:  translate/**/*           (no fetch(), no fs.*, no imports from request/ or index)
Handlers:         handlers/**             (imports from translate, request, config)
Router:           routing.ts              (imports from config only)
Entry:            index.ts, server.ts     (must NOT import from translate/ directly)
```

### Layer Isolation Rules

| Layer | Files | Can Import From | Cannot Import From |
|-------|-------|-----------------|-------------------|
| Config | `config.ts` | package.json, stdlib | Any src/ module |
| Utilities | `auth.ts`, `vision.ts`, `cache.ts`, `backpressure.ts`, `think-tag-stripper.ts`, `type-guards.ts` | Config, stdlib | translate/, request/, handlers/, index |
| Request Util | `request.ts` | Auth, Config, stdlib | translate/, handlers/ |
| Translate | `translate/**/*.ts` | Config, cache, type-guards, stdlib | request/, handlers/, index, fetch() |
| Handlers | `handlers/*.ts` | Config, request, translate, vision, cache | Entry points |
| Router | `routing.ts` | Config | translate/, request/, handlers/ |
| Entry | `index.ts` | All handlers, config, request, routing | translate/ directly |

---

## 2. Module Dependency Map

### Source Module Graph (src/)

```
src/index.ts                          (Hono app, CORS, route dispatch)
    |-- src/routing.ts                (URL prefix parsing, upstream resolution)
    |       |-- src/config.ts         (upstream URLs, vision sets, timeouts)
    |
    |-- src/handlers/index.ts         (barrel export)
    |       |-- src/handlers/messages.ts           (Anthropic -> OpenAI)
    |       |-- src/handlers/chat-completions.ts   (OpenAI -> Anthropic)
    |       |-- src/handlers/responses.ts          (Responses API -> Chat Completions)
    |       |-- src/handlers/models.ts             (model list proxy with caching)
    |       |-- src/handlers/health.ts             (health check endpoint)
    |       |-- src/handlers/shared.ts             (RouteInfo interface)
    |
    |-- src/request.ts                (auth, fetch, body check, streaming signal)
    |       |-- src/auth.ts           (key extraction, validation)
    |       |-- src/config.ts
    |
    |-- src/vision.ts                 (image detection, vision model selection)
    |       |-- src/config.ts
    |
    |-- src/cache.ts                  (prompt cache key, usage extraction)
    |       |-- src/translate/type-guards.ts
    |
    |-- src/translate/index.ts        (barrel export, pure re-exports)
            |-- src/translate/request/anthropic-to-openai.ts
            |       |-- src/cache.ts, type-guards
            |-- src/translate/request/openai-to-anthropic.ts
            |       |-- type-guards
            |-- src/translate/request/responses-to-chat-completions.ts
            |       |-- helpers, type-guards
            |-- src/translate/request/responses-helpers.ts
            |       |-- type-guards
            |-- src/translate/response/anthropic-to-openai.ts
            |       |-- src/cache.ts, type-guards
            |-- src/translate/response/openai-to-anthropic.ts
            |       |-- src/cache.ts, type-guards
            |-- src/translate/response/chat-completions-to-responses.ts
            |       |-- src/cache.ts, think-tag-stripper, type-guards
            |-- src/translate/stream/anthropic-to-openai.ts
            |       |-- src/config.ts, backpressure
            |-- src/translate/stream/openai-to-anthropic.ts
            |       |-- src/cache.ts, config.ts, backpressure, sse-encoder, sse-parser
            |       |   finish-reason
            |-- src/translate/stream/chat-completions-to-responses.ts
            |       |-- src/cache.ts, think-tag-stripper, backpressure, sse-encoder,
            |       |   sse-parser, type-guards
            |-- src/translate/stream/sse-encoder.ts
            |-- src/translate/stream/sse-parser.ts
            |-- src/translate/stream/finish-reason.ts
            |-- src/translate/type-guards.ts
```

### Deployment Entry Points

```
server.ts                             (Bun standalone binary entry)
    |-- src/index.ts

wrangler.toml                         (Cloudflare Workers entry: src/index.ts)
```

---

## 3. API Translation Flows

### Flow A: Anthropic Messages -> OpenAI Chat Completions

```
Client (Anthropic SDK)
    |
    | POST /v1/messages
    | X-Upstream-Format: openai  (default)  [or X-Upstream-Url override]
    v
src/index.ts  -- route dispatch -->  src/handlers/messages.ts
    |
    | 1. authenticateRequest()          -- extract + validate API key
    | 2. safeJsonBody()                 -- parse request body
    | 3. Route model override           -- URL segment > vision > thinking
    | 4. hasImages() check              -- detect Anthropic-style image blocks
    | 5. getVisionModel()               -- select vision-capable model if needed
    | 6. formatAnthropicToOpenAI()      -- pure: translate body format
    | 7. Fetch upstream /v1/chat/completions  (with retry)
    |
    |--- Non-streaming:
    |   8a. toOpenAIResponse()          -- pure: translate response format
    |--- Streaming:
    |   8b. streamAnthropicToOpenAI()   -- pure: translate SSE events on the fly
    |
    v
Upstream (opencode.ai/zen/go)
```

### Flow B: OpenAI Chat Completions -> Anthropic Messages

```
Client (OpenAI SDK)
    |
    | POST /v1/chat/completions
    | X-Upstream-Format: anthropic
    v
src/index.ts  -- route dispatch -->  src/handlers/chat-completions.ts
    |
    | 1. authenticateRequest()
    | 2. safeJsonBody()
    | 3. Route model override  (URL -> vision -> thinking chain)
    | 4. hasOpenAIImages() check
    | 5. formatOpenAIToAnthropic()      -- pure: translate body
    | 6. Fetch upstream /v1/messages    (with Anthropic auth headers)
    |
    |--- Non-streaming:
    |   7a. toAnthropicResponse()       -- pure: translate response
    |--- Streaming:
    |   7b. streamOpenAIToAnthropic()   -- pure: translate SSE events
    |
    v
Upstream (opencode.ai/zen/go)
```

### Flow C: OpenAI Responses API -> Chat Completions

```
Client (OpenAI Responses API SDK, e.g. Codex CLI)
    |
    | POST /v1/responses
    v
src/index.ts  -- route dispatch -->  src/handlers/responses.ts
    |
    | 1. authenticateRequest()
    | 2. safeJsonBody()
    | 3. Route model override
    | 4. hasResponsesImages() check     -- detect input_image/image_url blocks
    | 5. getVisionModel()
    | 6. Auto-inject thinking for DeepSeek models  (thinking: {type: "enabled"})
    | 7. formatResponsesToChatCompletions()   -- pure: Responses -> Chat Completions
    | 8. Fetch upstream /v1/chat/completions
    |
    |--- Non-streaming:
    |   9a. formatChatCompletionsToResponses()  -- reverse translation
    |       + stripThinkTags()                  -- strip <think> for minimax-m3-free
    |--- Streaming:
    |   9b. streamChatCompletionsToResponses()  -- SSE -> SSE on the fly
    |       + ThinkTagStripper                  -- stateful tag stripping across chunks
    |
    v
Upstream (opencode.ai/zen/go)
```

### Flow D: Pass-Through (no format translation)

Both `/v1/messages` and `/v1/chat/completions` support a pass-through path:

- **Fast path**: No model override AND no image markers in raw body string -> forward body verbatim to upstream with format-appropriate auth headers.
- **Slow path**: Model override OR image detection needed -> parse body, apply override, re-serialize.

### Flow E: Model List

```
Client
    |
    | GET /v1/models
    v
src/index.ts  -- route dispatch -->  src/handlers/models.ts
    |
    | 1. authenticateRequest()
    | 2. Check Cloudflare Cache API       (URL-based cache key, 300s TTL)
    | 3. Fetch upstream /v1/models        (with format-aware auth headers)
    | 4. Cache response (async put, fire-and-forget)
    |
    v
Upstream model list
```

### Flow F: Health Check

```
Client
    |
    | GET /
    v
src/index.ts  -- route dispatch -->  src/handlers/health.ts
    |
    | No auth required
    | Returns: name, version, status, uptime, upstream URLs, endpoint docs
```

### URL Routing Table

| Path Pattern | Handler | Translation | Notes |
|---|---|---|---|
| `GET /` | `handleHealthCheck` | None | No auth required |
| `POST /v1/messages` | `handleAnthropicToOpenAI` | Anthropic -> OpenAI (if X-Upstream-Format: openai) or pass-through | Anthropic client path |
| `POST /v1/chat/completions` | `handleOpenAIChatCompletions` | OpenAI -> Anthropic (if X-Upstream-Format: anthropic) or pass-through | OpenAI client path |
| `POST /v1/responses` | `handleResponsesAPI` | Responses API -> Chat Completions (one-way) | Codex CLI path |
| `GET /v1/models` | `handleModelList` | None | With Cloudflare Cache API |
| `/go/...` | (prefix to all above) | Upstream = GO_UPSTREAM | URL prefix routing |
| `/zen/...` | (prefix to all above) | Upstream = ZEN_UPSTREAM | URL prefix routing |
| `/<model>/...` | (model=first URL segment) | Route model override | Model-specific routing |

---

## 4. Deployment Architecture

### Primary: Cloudflare Workers

```
                    Cloudflare Edge Network
+------------------------------------------------------+
|                                                        |
|   Client Request  -->  Cloudflare Worker  -->  Upstream|
|   (Any HTTP)           opencode-cowork-proxy           opencode.ai/zen
|                                                   [or /zen/go]
|   Response  <--  Response  <--  Response
+------------------------------------------------------+

Worker Config (wrangler.toml):
  - main: src/index.ts
  - compatibility_date: 2026-06-01
  - account_id: 6ce8a1d8d04fb4c62f4b7b8ee474e289
```

### Secondary: Bun Standalone Binary

```
+-----------------------------------------------+
|                                                 |
|  Client  <-->  Bun Process (Bun.serve)  <--> Upstream|
|                   server.ts                          |
|                   Port 8787 (default)                |
+-----------------------------------------------+

Build: bun build --compile --outfile opencode-cowork-proxy server.ts
```

### Tertiary: Vercel Serverless

```
+-----------------------------------------------------+
|                                                       |
|  Client  -->  Vercel Edge/Serverless  -->  Upstream    |
|               vercel.json                              |
|               (outputDirectory: ".")                   |
+-----------------------------------------------------+

Config: minimal vercel.json -- Hono app is self-contained.
```

### Upstream Architecture

```
+---------------------------------------------------------------+
|                        opencode.ai                             |
|                      (upstream provider)                       |
+-------------------------------+-------------------------------+
                                |
            +-------------------+-------------------+
            |                   |                   |
      /zen/go (GO_UPSTREAM)    |       /zen (ZEN_UPSTREAM)
      Default upstream         |       Alt upstream
      https://opencode.ai/zen/go|       https://opencode.ai/zen
                                |
            Header-based override via X-Upstream-Url
```

---

## 5. Key Design Decisions (ADRs)

### ADR-1: Request utilities as singleton module

**Context**: `src/request.ts` combines auth orchestration, upstream fetch, error relay, gzip compression, JSON response construction, and body size checking -- multiple concerns in one file.

**Decision**: Keep as a single module because the entry point (`index.ts`) needs all of these at every branch point. Splitting would create awkward multi-level imports without reducing coupling. The file is large (221 lines) but within the 500-line limit.

**Consequence**: Test `cache.test.ts` currently imports from `request.ts` to test the `formatUptime` function -- a minor violation of strict layering. `formatUptime` could be extracted to a pure utility if this becomes problematic.

### ADR-2: Pure translation functions

**Decision**: All 9 translation modules in `translate/` are pure functions -- no `fetch()`, no `fs.*`, no I/O. They accept `Record<string, unknown>` and return `Record<string, unknown>`. Stream translators accept `ReadableStream` and return `ReadableStream`.

**Consequence**: Translation is testable without mocking network or filesystem. Each translator is a mapping function with well-defined input/output contracts.

### ADR-3: `Record<string, unknown>` for JSON payloads

**Context**: The proxy operates on opaque JSON across 3 API formats (Anthropic Messages, OpenAI Chat Completions, OpenAI Responses API). No shared type definitions exist between formats.

**Decision**: Use `Record<string, unknown>` throughout translation layers with type-guard helpers (`asRecord`, `asRecordArray`, `asRecordOptional`) for safe narrowing. Avoids coupling to a schema library while maintaining type safety.

**Consequence**: Translation code requires careful runtime type narrowing. The `type-guards.ts` module provides standardized helpers -- never use bare `as` casts.

### ADR-4: URL-based routing (no Hono router)

**Decision**: Routing uses explicit `new URL(request.url).pathname` parsing with custom prefix stripping (`/go/`, `/zen/`) and model segment extraction. Hono's `app.all('*')` catches all paths with a single handler.

**Rationale**: The custom routing provides flexible model override from URL path (e.g., `/claude-sonnet-4/v1/messages`) without needing to configure Hono routes per model. The Hono app is primarily used for CORS middleware.

### ADR-5: Model override chain order

**Order**: URL segment model override -> vision model override -> (Responses API only) DeepSeek thinking injection.

**Rationale**: URL override is explicit user intent and should take highest priority. Vision override happens next because it may change to a vision-capable model. DeepSeek thinking injection must run AFTER vision override to avoid injecting `thinking: {type:"enabled"}` on a non-DeepSeek model that was force-changed by image detection.

### ADR-6: One-directional Responses API translation

**Decision**: The `/v1/responses` endpoint translates Responses API -> Chat Completions (one direction only). There is no reverse path for Chat Completions -> Responses API in the request path. The Responses API format uses event-based SSE for streaming (named events) rather than data-only SSE.

**Rationale**: Responses API is a newer, more complex format. Full bidirectional translation would require significant additional state management. The current design supports OpenAI Responses clients while keeping the upstream call in Chat Completions format which all upstream providers understand.

### ADR-7: Think tag stripping with stateful stream handler

**Context**: Some upstream models (minimax-m3-free) embed reasoning content as `<think>...</think>` tags within text content instead of separate `reasoning_content` or `thinking` fields.

**Decision**: Non-streaming responses use simple regex (`/<think>[\s\S]*?<\/think>/g`). Streaming uses a stateful `ThinkTagStripper` class that tracks open/close tag boundaries across SSE chunks.

**Consequence**: All Responses API responses (both streaming and non-streaming) strip think tags before returning to client.

### ADR-8: API key minimum length check (32 chars)

**Decision**: Auth validates API key with a minimum length of 32 characters. No specific key format beyond length. Keys extracted from `X-Api-Key` header (preferred) or `Authorization: Bearer` header.

**Rationale**: The proxy does not generate or manage API keys -- it only validates them before forwarding to upstream. The 32-char minimum prevents accidental empty or obviously invalid keys from wasting upstream calls.

---

## 6. Constraint Rules

### C1: File size (M3)

```
Source files:  max 500 lines
Test files:    max 500 lines
Config files:  max 400 lines

Enforced by: test/architecture.spec.ts "M3 -- File size"
```

**Current largest files** (approximate):
- `src/translate/stream/chat-completions-to-responses.ts` (430 lines)
- `src/translate/stream/openai-to-anthropic.ts` (340 lines)
- `src/translate/stream/anthropic-to-openai.ts` (217 lines)
- `src/translate/request/openai-to-anthropic.ts` (203 lines)
- `src/handlers/chat-completions.ts` (133 lines)
- `src/handlers/responses.ts` (161 lines)

### C2: Import count (M4)

```
Per file: max 10 import statements

Enforced by: test/architecture.spec.ts "M4 -- Import count"
```

### C3: Translation purity (D1)

```
Translate modules must NOT contain:
  - fetch() calls
  - fs.* calls
  - Any I/O operations

Enforced by: test/architecture.spec.ts "D1 -- Pure translation functions"
```

### C4: Translate isolation (L1)

```
Translate modules must NOT import from:
  - src/request.ts
  - src/index.ts or src/handlers/

Enforced by: test/architecture.spec.ts "L1 -- Translate modules isolation"
```

### C5: Request utility isolation (L2)

```
src/request.ts must NOT import from:
  - Any translate/ module

Enforced by: test/architecture.spec.ts "L2 -- request.ts isolation"
```

### C6: Utility isolation (L3)

```
Utility files (routing.ts, auth.ts, vision.ts, backpressure.ts,
               think-tag-stripper.ts) must NOT import from:
  - translate/, request/, or index.ts

Enforced by: test/architecture.spec.ts "L3 -- Utilities isolation"
```

### C7: Entry point isolation (L5)

```
Entry points (server.ts, vercel entry) must ONLY import index.ts
(no direct imports from handlers/, translate/, request/, etc.)

Enforced by: test/architecture.spec.ts "L5 -- Entry point isolation"
```

### C8: Translation barrel integrity

```
src/translate/index.ts must be a pure barrel file (no imports).

Enforced by: test/architecture.spec.ts "Translation barrel integrity"
```

### C9: Type safety

```
Rules:
  - Use type-guards (asRecord, asRecordArray, asRecordOptional) instead of bare `as` casts
  - No `any` type annotations (use `Record<string, unknown>` for opaque JSON)
  - No @ts-ignore / @ts-expect-error
  - Limit non-null assertions (!.) to 3 per file

Enforced by: .claude/skills/architecture-guard/scripts/check-type-safety.mjs
```

### C10: Naming conventions

```
Files:
  - Utility files: camelCase (.ts)
  - Test files: .test.ts or .spec.ts suffix

Code:
  - Constants: UPPER_SNAKE_CASE
  - Types/interfaces: PascalCase
  - Functions/variables: camelCase

Enforced by: .claude/skills/architecture-guard/scripts/check-naming.mjs
```

### C11: Naming conventions (project-specific)

```
- Handler export pattern:     handle[Endpoint]      (e.g., handleAnthropicToOpenAI)
- Request translator export:  format[From]To[To]    (e.g., formatAnthropicToOpenAI)
- Response translator export: to[Format]Response    (e.g., toOpenAIResponse)
  or format[From]To[To]                              (e.g., formatChatCompletionsToResponses)
- Stream translator export:  stream[From]To[To]     (e.g., streamAnthropicToOpenAI)
- Utility exports: descriptive camelCase             (e.g., authenticateRequest, safeJsonBody)
```

---

## 7. Project File Inventory

### Source files (src/)

| File | Lines | Role | Depends On |
|------|-------|------|------------|
| `index.ts` | 77 | Entry point, CORS, dispatch | routing, request, handlers |
| `routing.ts` | 59 | URL prefix parsing, upstream resolution | config |
| `config.ts` | 91 | Constants: upstreams, vision sets, timeouts | none (stdlib only) |
| `request.ts` | 221 | Auth, fetch, body check, streaming signal | auth, config |
| `auth.ts` | 53 | API key extraction, validation | none |
| `vision.ts` | 97 | Image detection, vision model selection | config |
| `cache.ts` | 121 | Prompt cache key, token extraction | type-guards |
| `version.ts` | 14 | Version from package.json | package.json |
| `backpressure.ts` | 24 | Stream backpressure helper | none |
| `think-tag-stripper.ts` | 79 | Stream/non-stream think tag stripping | none |
| `translate/type-guards.ts` | 30 | Safe type narrowing for JSON payloads | none |
| `translate/index.ts` | 33 | Barrel re-exports (9 modules) | all translate modules |
| `translate/request/anthropic-to-openai.ts` | 160 | Request body translation A->O | cache, type-guards |
| `translate/request/openai-to-anthropic.ts` | 203 | Request body translation O->A | type-guards |
| `translate/request/responses-to-chat-completions.ts` | 206 | Request: Responses -> Chat | helpers, type-guards |
| `translate/request/responses-helpers.ts` | 142 | Shared helpers for Responses | type-guards |
| `translate/response/anthropic-to-openai.ts` | 76 | Response body translation A->O | cache |
| `translate/response/openai-to-anthropic.ts` | 83 | Response body translation O->A | cache, type-guards |
| `translate/response/chat-completions-to-responses.ts` | 108 | Response: Chat -> Responses | cache, think-stripper, type-guards |
| `translate/stream/anthropic-to-openai.ts` | 217 | SSE stream translation A->O | config, backpressure |
| `translate/stream/openai-to-anthropic.ts` | 340 | SSE stream translation O->A | cache, config, backpressure, sse |
| `translate/stream/chat-completions-to-responses.ts` | 428 | SSE: Chat -> Responses | cache, think-stripper, backpressure, sse, type-guards |
| `translate/stream/sse-encoder.ts` | 20 | Shared SSE encoder factory | none |
| `translate/stream/sse-parser.ts` | 49 | Shared SSE frame parser | none |
| `translate/stream/finish-reason.ts` | 19 | finish_reason -> stop_reason map | none |
| `handlers/index.ts` | 20 | Handler barrel export | all handler files |
| `handlers/shared.ts` | 12 | RouteInfo interface | none |
| `handlers/messages.ts` | 135 | Anthropic -> OpenAI handler | translate, request, vision, config |
| `handlers/chat-completions.ts` | 132 | OpenAI -> Anthropic handler | translate, request, vision, config |
| `handlers/responses.ts` | 160 | Responses API handler | translate, request, vision, config |
| `handlers/models.ts` | 62 | Model list handler | request, config |
| `handlers/health.ts` | 39 | Health check handler | version, config, request |

### Test files (test/)

| File | Tests | Purpose |
|------|-------|---------|
| `architecture.spec.ts` | 6 groups, ~50 cases | Layer boundaries, file size, purity |
| `index.test.ts` | Integration | Full request/response pipeline |
| `auth.test.ts` | Unit | API key extraction, validation |
| `routing.test.ts` | Unit | URL prefix parsing, upstream resolution |
| `vision.test.ts` | Unit | Image detection, model selection |
| `cache.test.ts` | Unit | Token extraction, usage mapping |
| `backpressure.test.ts` | Unit | Stream backpressure behavior |
| `think-tag-stripper.test.ts` | Unit | Think tag stripping (stream + non-stream) |
| `model-override.test.ts` | Unit | URL/vision model override logic |
| `error-handling.test.ts` | Unit | Upstream error relay, retry logic |
| `utils.test.ts` | Unit | Shared utility functions |
| `anthropic-to-openai-request.test.ts` | Unit | Request translation A->O |
| `openai-to-anthropic-request.test.ts` | Unit | Request translation O->A |
| `response.test.ts` | Unit | Response translation A->O |
| `responses-api.test.ts` | Integration | Responses API full pipeline |
| `responses-request.test.ts` | Unit | Responses request translation |
| `responses-response.test.ts` | Unit | Responses response translation |
| `responses-stream.test.ts` | Unit | Responses streaming translation |
| `stream.test.ts` | Unit | SSE stream translation |

### Deployment files

| File | Role |
|------|------|
| `wrangler.toml` | Cloudflare Workers configuration |
| `server.ts` | Bun standalone server entry |
| `vercel.json` | Vercel serverless configuration |
| `package.json` | Dependency management, scripts |

### Architecture enforcement files

| File | Role |
|------|------|
| `test/architecture.spec.ts` | Vitest-based architecture boundary tests |
| `.claude/skills/architecture-guard/scripts/check-layers.mjs` | Generic layer dependency check |
| `.claude/skills/architecture-guard/scripts/check-naming.mjs` | Naming convention check |
| `.claude/skills/architecture-guard/scripts/check-file-size.mjs` | File size threshold check |
| `.claude/skills/architecture-guard/scripts/check-type-safety.mjs` | Type safety lint check |

---

## Architecture Guard Scripts Assessment

The existing architecture-guard scripts in `.claude/skills/architecture-guard/scripts/` are **generic** -- they work across any project by scanning directory structure and applying broad rules (layer detection via folder names, generic naming patterns, file size thresholds, type safety checks).

### What they cover well for this project

- **Type safety**: `check-type-safety.mjs` catches `any` annotations, `as` casts, `@ts-ignore`, and non-null assertions. Projects with many raw `as` casts will trigger warnings. The `as` regex threshold (2 occurrences) may generate false positives for legitimate `as` casts in test files -- the project's `.spec.ts` files use `as` for type narrowing in assertions.
- **File size**: `check-file-size.mjs` -- threshold of 500 lines matches this project's constraint.
- **Naming conventions**: `check-naming.mjs` validates file names (camelCase for utils, PascalCase for types) and code naming conventions.

### What is missing specifically for this project

The generic scripts do not validate the project-specific invariants captured in `test/architecture.spec.ts`:

1. **Layer isolation rules** -- The `architecture-guard` scripts detect layers by folder names (`types/`, `config/`, `service/`, `ui/`, etc.) which do not match this project's directory structure. The actual layer enforcement is done by `test/architecture.spec.ts`.
2. **Translation purity** -- No check for `fetch()` in translate modules.
3. **Barrel file integrity** -- No check that barrel re-export files are import-free.
4. **Entry point isolation** -- No check that entry points only import index.ts.
5. **Import count limits** -- Not checked by the generic scripts.
6. **Project-specific naming patterns** -- Handler/translator/stream export naming conventions.

### Recommendation

Keep `test/architecture.spec.ts` as the primary architecture enforcement mechanism -- it is specific to this project's structure and invariants. The generic `architecture-guard` scripts serve as a secondary safety net for cross-cutting concerns (type safety, file size, naming). If adding to the architecture-guard scripts, focus on project-specific rules:

- Add a check that translate modules contain no `fetch()` or `fs.` references
- Add a check that barrel files (`translate/index.ts`, `handlers/index.ts`) contain no imports
- Add a check that `server.ts` only imports `src/index.ts`
