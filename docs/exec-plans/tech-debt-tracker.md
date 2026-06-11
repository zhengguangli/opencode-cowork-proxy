# Tech Debt Tracker: opencode-cowork-proxy

> Known tech debt items, planned refactors, and legacy patterns to address.

## Active Items

### P1: Test File `as` Casts (Partially Fixed)

- **Issue**: Some test files use bare `as` assertions for type narrowing at test boundaries. TypeScript 6.x strict mode flags these. 27 instances cleaned in commit aa654ae.
- **Status**: Partially resolved. Remaining `as` casts in test files need review -- some are legitimate (casting test fixture data), others should use type-guard helpers.
- **Files affected**: `test/` directory files
- **Fix**: Replace bare `as` with `asRecord`/`asRecordArray`/`asRecordOptional` from `type-guards.ts`, or cast through intermediate types where format conversion test data is known to match.

### P2: `cache.test.ts` Imports from `request.ts`

- **Issue**: `test/cache.test.ts` imports `formatUptime()` from `src/request.ts` to test its behavior. This is a minor violation -- `formatUptime` is a pure formatting function that belongs in a utility module, not in `request.ts` (which orchestrates auth/fetch/response logic).
- **Status**: Documented in ARCHITECTURE.md ADR-3.
- **Fix**: Extract `formatUptime()` to a dedicated utility file (e.g., `src/utils.ts` or `src/uptime.ts`), update both `request.ts` and `cache.test.ts` imports.

### P3: `safeJsonBody` vs Pass-Through Parsing Pattern

- **Issue**: Handlers use `safeJsonBody()` in the translation path, but the pass-through path reimplements JSON parsing with try/catch manually. This duplication increases maintenance surface.
- **Files affected**: `handlers/messages.ts` (lines 94-101), `handlers/chat-completions.ts` (lines 90-97)
- **Fix**: Unify parsing by always using `safeJsonBody()` or a shared wrapper. The pass-through path historically parsed raw body text for the fast-path bypass optimization.

### P4: No Integration Test Coverage for Pass-Through Path

- **Issue**: The pass-through fast path (no model override + no images) has no dedicated test coverage. All current tests exercise the translation path.
- **Impact**: A regression in the pass-through fast path would go undetected by CI.
- **Fix**: Add test cases for pass-through scenarios in both `messages.ts` and `chat-completions.ts` handlers.

### P5: Debug Log Overhead

- **Issue**: `IS_DEBUG` guards are used throughout handlers (especially `responses.ts`) for verbose logging. In production, the `DEBUG` env var check and branching still execute on every request.
- **Impact**: Negligible (env-var check is sub-ms), but the log statements remain in production binary.
- **Fix**: Consider compile-time stripping for the Bun standalone binary, or accept as intentional (debug logging for deployed troubleshooting).

### P6: `query` Variable Name Typo in Vision Functions

- **Issue**: In `src/vision.ts`, local variable `query` is used throughout (e.g., "Images detected in user's prompt" via `hasImages`), but some internal tests reference parameters as `req` instead of `body`. Minor naming inconsistency.
- **Status**: Cosmetic only, no functional impact.

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
