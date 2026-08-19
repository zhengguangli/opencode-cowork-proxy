# Project Instructions: opencode-cowork-proxy

## 1. Project Goal
Bidirectional AI API translation gateway (Anthropic ↔ OpenAI ↔ Responses API) deployed on Cloudflare Workers and Bun.

## 2. Mandatory Architecture Invariants
Strict unidirectional dependency flow is enforced by `test/architecture.test.ts`. Always run tests after structural changes.
**Config** → **Utilities** → **Request Util** → **Translate** → **Handlers** → **Router** → **Entry Point**

### Layer Constraints:
- **Config (`src/config.ts`)**: NO imports from `src/`.
- **Utilities** (`auth.ts`, `vision.ts`, `cache.ts`, `backpressure.ts`, `think-tag-stripper.ts`): NO imports from `translate/`, `request/`, `handlers/`.
- **Request Util (`src/request.ts`)**: NO imports from `translate/` or `handlers/`.
- **Translate (`src/translate/**/*`)**: MUST be **pure functions** (no `fetch()`, no I/O). NO imports from `request/` or `handlers/`.
- **Handlers**: NO imports from Entry Points.
- **Router**: Imports from `config` only.
- **Entry Points**: MUST NOT import from `translate/` directly; must use Handlers.

## 3. Coding Standards
- **No `any`**: Use `Record<string, unknown>` for opaque JSON payloads.
- **Type Safety**: Use `src/translate/type-guards.ts` helpers (`asRecord`, `asRecordArray`, `asRecordOptional`) instead of bare `as` casts.
- **File Size**: Max 500 lines for source/test files.
- **Imports**: Max 10 import statements per file.
- **Logging**: Use `src/logger.ts` for all logging. Use `trace_id` for request correlation.
- **Errors**: Propagate upstream errors using `upstreamErrorResponse` from `src/request.ts`.

## 4. Workflows & Tooling
- **Testing**: `bun test` (Verify all 586+ tests pass)
- **Typecheck**: `bun run typecheck`
- **OpenAPI**: `bun run scripts/generate-openapi.mjs` (Updates `docs/openapi.json`)
- **Build**: `bun run dev` (Bun) or `wrangler deploy` (Cloudflare)

## 5. Naming Conventions
- **Handlers**: `handle[Endpoint]` (e.g., `handleAnthropicToOpenAI`)
- **Request Translators**: `format[From]To[To]` (e.g., `formatAnthropicToOpenAI`)
- **Response Translators**: `to[Format]Response` (e.g., `toOpenAIResponse`) or `format[From]To[To]`
- **Stream Translators**: `stream[From]To[To]` (e.g., `streamAnthropicToOpenAI`)

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
