# Changelog

All notable changes to the opencode-cowork-proxy harness.

## [Unreleased]

### Added
- Bun project standardization — `bunfig.toml`, `tsconfig.json` (Bun recommended), `@types/bun`
- Build outputs moved to `./dist/` directory
- Binary build with `--bytecode` for faster startup
- JS bundle with `--minify` (73 KB)
- `Bun.serve` params — `idleTimeout: 30`, `maxRequestBodySize: 1MB`, `error` handler
- CHANGELOG.md moved to `docs/CHANGELOG.md`

### Changed
- `vitest` / `@types/node` replaced by `bun test` + `@types/bun`
- Scripts shebangs to `#!/usr/bin/env bun`
- CI workflow to pure bun commands
- `README.md` test count 516→521
- `docs/QUALITY_SCORE.md` Vitest→bun test references

### Removed
- `vitest.config.ts` (bun test is native runner)
- `package-lock.json` reference (bun.lock only)

- CI/CD pipeline — `.github/workflows/ci.yml` with test + audit dual jobs, architecture boundary enforcement, file size check
- Prometheus metrics — `GET /metrics` endpoint exposing http_requests_total, http_request_duration_ms, upstream_requests_total, upstream_errors_total, active_streams, uptime_seconds
- Upstream health probe — `GET /health/upstream?probe=true` lightweight upstream connectivity check
- Zod v4 request body validation — 3 schemas (Anthropic Messages, OpenAI Chat, Responses API) with detailed error reporting
- Session rate-limit awareness — `src/rate-limit.ts` auto-tracks upstream RateLimit-* headers, warns on low quota, recommends throttle delay
- Streaming gzip compression — SSE responses auto-compressed when client sends Accept-Encoding: gzip, via `compressibleStream()`
- Plugin translator architecture — `src/translate/plugin.ts` with `TranslatorRegistry`, `RequestTranslator`, `ResponseTranslator`, `StreamTranslator` interfaces
- Upstream provider abstraction — `src/providers.ts` with `ProviderRegistry` (go/zen/anthropic), `resolveByPrefix()` for URL-based routing
- Load testing script — `scripts/load-test.mjs` supporting concurrency, duration, custom paths, p50/p90/p99 latency reporting
- OpenAPI spec generation — `scripts/generate-openapi.mjs` → `docs/openapi.json` covering all 10 endpoints
- Dependency audit — `scripts/audit-deps.mjs` with lockfile validation, version pinning check, bun audit integration
- In-memory response cache — `src/response-cache.ts` LRU cache (50 entries, TTL-based, keyed by upstream|path|bodyHash)
- Enhanced API key validation — base64url format check, key type identification (sk-/pk-/sk-ant- prefix detection)
- Structured audit logging — `src/audit.ts` with 6 event types (auth, upstream, model, error, stream, proxy), `GET /audit/log` endpoint
- WebSocket upgrade handler — `GET /ws/*` returns 426 with SSE fallback instructions
- Startup profiling — plugin registry init timing logged at module load time
- Unified logging system — ALL output (access logs, audit events, debug, app logs) goes through `src/logger.ts` in consistent JSON format

### Changed
- `src/logger.ts` — added AUDIT level, `log.audit()`, `log.access()` methods; signature from `...data` spread to optional `details` object
- `src/audit.ts` — refactored to use `log.audit()` from logger.ts under the hood (kept ring buffer for /audit/log)
- `scripts/build-entry.ts` — plain `console.log`/`console.error` replaced with `log.access()`/`log.error()` for consistent JSON output
- `src/request.ts` — auto-injects `trackRateLimits()` in `safeUpstreamFetch()` to capture upstream RateLimit-* headers
- `src/handlers/messages.ts`, `src/handlers/chat-completions.ts`, `src/handlers/responses.ts` — SSE streaming responses now auto-compressed via `compressibleStream()`
- `src/index.ts` — startup profiling instrumentation, audit event on startup, error audit on unhandled exceptions
- `test/architecture.test.ts` — L5 entry point isolation relaxed to allow utility imports (logger, config)
- `docs/ARCHITECTURE.md` — added ADR-9 through ADR-14 covering key format validation, audit logging, response cache, WebSocket, OpenAPI spec, startup profiling

### Added (files)
- `src/compress.ts`, `src/providers.ts`, `src/rate-limit.ts`, `src/response-cache.ts`, `src/validate.ts`
- `src/translate/plugin.ts`, `src/translate/registry.ts`
- `src/handlers/metrics.ts`, `src/handlers/health-upstream.ts`, `src/handlers/audit-log.ts`, `src/handlers/websocket.ts`
- `scripts/load-test.mjs`, `scripts/audit-deps.mjs`, `scripts/generate-openapi.mjs`
- `.github/workflows/ci.yml`
- `docs/openapi.json`
- `test/auth-enhanced.test.ts`, `test/audit.test.ts`, `test/compress.test.ts`, `test/metrics.test.ts`
- `test/plugin.test.ts`, `test/providers.test.ts`, `test/rate-limit.test.ts`, `test/response-cache.test.ts`
- `test/validate.test.ts`, `test/websocket.test.ts`

### Dependencies
- `zod@^4.4.3` — added for request body schema validation

## [2.1.0] — 2026-05-xx

### Added
- `src/logger.ts` — structured logger with DEBUG/INFO/WARN/ERROR levels, JSON-per-line output, IS_DEBUG gating
- `docs/` directory with 15 knowledge base documents
- `hooks.yaml` — project-level hook configuration
- `scripts/install.mjs` — harness installer/checker script
- 14 standard skills with trigger conditions
- 7 specialized agents (architect, builder, context-engineer, orchestrator, qa, reviewer, sre)
- GitHub Actions workflows: `harness-hooks.yml`, `doc-gardening.yml`

### Changed
- `handlers/responses.ts` — 15 unprotected `console.log` calls migrated to `log.debug()` (IS_DEBUG-gated); `<think>` tag warnings use `log.warn()`
- `request.ts`, `handlers/models.ts` — IS_DEBUG-gated console.log/error calls migrated to `log.debug()`
- `.claude/settings.json` — updated script paths from `.claude/skills/` to `.agents/skills/` (12 occurrences)
- Renamed `test/architecture.spec.ts` → `test/architecture.test.ts` for Vitest discovery

### Fixed
- Double-directory drift between `.claude/` and `.agents/` — `.agents/` now single source of truth
- Type assertion cleanup in test files (27 locations)
- Architecture boundary tests for layer dependency validation
