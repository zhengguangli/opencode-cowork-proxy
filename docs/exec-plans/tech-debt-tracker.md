# Tech Debt Tracker: opencode-cowork-proxy

> Known tech debt items, planned refactors, and legacy patterns to address.

## Active Items

### P1: Test File `as` Casts (Mostly Fixed)

- **Issue**: Some test files use bare `as` assertions for type narrowing at test boundaries. TypeScript 6.x strict mode flags these. 27+ instances cleaned across multiple commits.
- **Status**: Mostly resolved. Remaining `as` casts are legitimate test patterns (JSON response parsing, mock type assertions, edge-case test inputs). The `undefined as unknown as Record<string, unknown>` pattern in `cache.test.ts` and `vision.test.ts` tests invalid inputs to verify graceful handling; changing to `asRecord()` would alter behavior since it returns `{}` for non-objects.
- **Files affected**: `test/` directory files
- **Fix**: Replace bare `as` with `asRecord`/`asRecordArray`/`asRecordOptional` from `type-guards.ts` where the input is known to match the target type. Edge-case tests with intentionally invalid inputs should keep explicit casts.

### P2: `cache.test.ts` Imports from `request.ts` ✅ FIXED

- **Issue**: `test/cache.test.ts` imported `formatUptime()` from `src/request.ts`.
- **Fix**: Extracted `formatUptime()` to `src/utils/formatUptime.ts`. Updated `src/handlers/health.ts` and `test/utils.test.ts` imports.

### P3: `safeJsonBody` vs Pass-Through Parsing Pattern ✅ FIXED

- **Issue**: Handlers used `safeJsonBody()` in the translation path but reimplemented JSON parsing in the pass-through path.
- **Fix**: Added `safeJsonParse(text)` to `src/request.ts` (sync counterpart with identical `Result` shape). Refactored pass-through paths in `src/handlers/messages.ts` and `src/handlers/chat-completions.ts`.

### P4: No Integration Test Coverage for Pass-Through Path ✅ FIXED

- **Issue**: The pass-through fast path had no dedicated test coverage.
- **Fix**: Created `test/pass-through.test.ts` with 4 integration tests covering Anthropic/OpenAI verbatim forwarding and image-detection bypass.

### P5: Debug Log Overhead

- **Issue**: `IS_DEBUG` guards execute on every request. In production, the env-var check and branching still execute.
- **Impact**: Negligible (sub-ms), but log statements remain in production binary.
- **Fix**: Accept as intentional (debug logging for deployed troubleshooting), or consider compile-time stripping for Bun standalone binary.

### P6: `query` Variable Name Typo in Vision Functions

- **Issue**: In `src/vision.ts`, local variable naming inconsistency between `query` and `req` in internal tests.
- **Status**: Not found in current codebase — may have been resolved in prior refactor. Cosmetic only, no functional impact.

## Resolved Items

### R1: Architecture Boundary Tests (Fixed in commit 009a732)

- **Issue**: Original `index.ts` was monolithic, handling routing, translation, and response construction in a single file (violating layer separation).
- **Fix**: Split into `routing.ts`, `handlers/`, `request.ts`, `config.ts`. Added architecture boundary tests.

### R2: Vision Model Catalog Stale Entries (Fixed in commit b34199d)

- **Issue**: `VISION_CAPABLE_GO` (Go upstream) was inflated with models only available on the Zen upstream, causing 404s when users sent images through /go prefix.
- **Fix**: Separated vision model sets by upstream with matching catalog verification.

### R3: Model Override Chain Order (Fixed in commit b34199d)

- **Issue**: DeepSeek thinking injection ran before vision override, injecting `thinking: {type:"enabled"}` on non-DeepSeek models force-changed by image detection.
- **Fix**: Reordered chain: URL -> vision -> thinking injection.

## Monitoring Items

- **TypeScript 6.x strict mode compatibility**: As TypeScript evolves, new strict checks may surface issues in translation type handling. Run `tsc --noEmit` periodically.
- **Hono framework updates**: Currently on v4.12.17. Major version changes may break the CORS middleware or `app.all` dispatcher.
- **Upstream model catalog drift**: Vision model sets in `config.ts` can become stale if upstream adds/removes vision-capable models. Verify periodically against upstream `/v1/models` endpoints.
