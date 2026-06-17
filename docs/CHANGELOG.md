<!--
CHANGELOG Format Standard (keepachangelog.com v1.1.0)

Version heading:      ## [X.Y.Z] — YYYY-MM-DD   (ISO date, no placeholders)
Unreleased heading:   ## [Unreleased]            (always at top, newest first)

Section order:
  ### Added → ### Changed → ### Deprecated → ### Removed → ### Fixed → ### Security
  Each section at most once per version. Empty Deprecated/Security may be omitted.

Entry rules:
  - One bullet per entry ("- "), past tense, no trailing period
  - File paths/config/keys in backticks (`src/foo.ts`)
  - Related items grouped into one bullet by comma, not split
  - Wrap at ~80–90 columns, 2-space indent on continuation
  - Within section: sort by significance, not chronologically
-->

# Changelog

All notable changes to the opencode-cowork-proxy harness.

## [Unreleased]

### Added

- Plugin translator architecture — `src/translate/plugin.ts` with
  `TranslatorRegistry`, `RequestTranslator`, `ResponseTranslator`,
  `StreamTranslator` interfaces
- Unified logging system — all output (access logs, audit events, debug, app
  logs) unified under `src/logger.ts` in consistent JSON format
- Upstream provider abstraction — `src/providers.ts` with `ProviderRegistry`
  (go/zen/anthropic), `resolveByPrefix()` for URL-based routing
- Zod v4 request body validation — 3 schemas (Anthropic Messages, OpenAI Chat,
  Responses API) with detailed error reporting
- CI/CD pipeline — `.github/workflows/ci.yml` with test + audit dual jobs,
  architecture boundary enforcement, file size check
- Structured audit logging — `src/audit.ts` with 6 event types (auth, upstream,
  model, error, stream, proxy), `GET /audit/log` endpoint
- Prometheus metrics — `GET /metrics` endpoint exposing
  `http_requests_total`, `http_request_duration_ms`,
  `upstream_requests_total`, `upstream_errors_total`, `active_streams`,
  `uptime_seconds`
- Streaming gzip compression — SSE responses auto-compressed via
  `compressibleStream()` when client sends `Accept-Encoding: gzip`
- In-memory response cache — `src/response-cache.ts` LRU cache (50 entries,
  TTL-based, keyed by `upstream|path|bodyHash`)
- Enhanced API key validation — base64url format check, key type
  identification (`sk-/pk-/sk-ant-` prefix detection)
- Session rate-limit awareness — `src/rate-limit.ts` auto-tracks upstream
  `RateLimit-*` headers, warns on low quota, recommends throttle delay
- Upstream health probe — `GET /health/upstream?probe=true` lightweight
  upstream connectivity check
- WebSocket upgrade handler — `GET /ws/*` returns 426 with SSE fallback
  instructions
- OpenAPI spec generation — `scripts/generate-openapi.mjs` →
  `docs/openapi.json` covering all 10 endpoints
- Load testing script — `scripts/load-test.mjs` with concurrency, duration,
  custom paths, p50/p90/p99 latency reporting
- Dependency audit — `scripts/audit-deps.mjs` with lockfile validation,
  version pinning check, bun audit integration
- Bun project standardization — `bunfig.toml`, `tsconfig.json` (Bun
  recommended), `@types/bun`
- Startup profiling — plugin registry init timing logged at module load time
- `zod@^4.4.3` — added for request body schema validation

### Changed

- Copied `.agents/agents/` and `.agents/skills/` into `.claude/` —
  `.claude/` now canonical path; updated all path references across 27+ files
  (AGENTS.md, CLAUDE.md, hooks.json, workflows, docs, .gitignore)
- Build outputs moved to `./dist/` directory; binary build with `--bytecode`
  (faster startup), JS bundle with `--minify` (73 KB); `Bun.serve` params set
  to `idleTimeout: 30`, `maxRequestBodySize: 1MB`, with error handler
- `vitest` / `@types/node` replaced by `bun test` + `@types/bun`; scripts
  shebangs to `#!/usr/bin/env bun`; CI workflow migrated to pure bun commands;
  `README.md` test count 516→521; `docs/QUALITY_SCORE.md` references updated
- CHANGELOG.md moved to `docs/CHANGELOG.md`
- `src/logger.ts` — added AUDIT level with `log.audit()`, `log.access()`
  methods; signature changed from `...data` spread to optional `details`
  object; `src/audit.ts` refactored to use `log.audit()` under the hood
- `scripts/build-entry.ts` — `console.log`/`console.error` replaced with
  `log.access()`/`log.error()` for consistent JSON output
- `src/handlers/messages.ts`, `chat-completions.ts`, `responses.ts` — SSE
  streaming responses now auto-compressed via `compressibleStream()`
- `src/request.ts` — auto-injects `trackRateLimits()` in
  `safeUpstreamFetch()` to capture upstream RateLimit-* headers
- `src/index.ts` — startup profiling instrumentation, audit event on startup,
  error audit on unhandled exceptions
- `docs/ARCHITECTURE.md` — added ADR-9 through ADR-14 covering key format
  validation, audit logging, response cache, WebSocket, OpenAPI spec, startup
  profiling
- `test/architecture.test.ts` — L5 entry point isolation relaxed to allow
  utility imports (logger, config)

### Removed

- `vitest.config.ts` (bun test is native runner)
- `package-lock.json` reference (bun.lock only)

### Fixed

- Removed dead references to `parallel-execution.md` in orchestrator SKILL.md
  (`.claude/` + `.agents/`)
- Fixed duplicate directory string in `harness-init/SKILL.md`
  (`.claude/", ".claude/"` → `.claude/", ".agents/"`)

## [2.1.0] — 2026-06-05

### Added

- `src/logger.ts` — structured logger with DEBUG/INFO/WARN/ERROR levels,
  JSON-per-line output, IS_DEBUG gating
- 14 standard skills with trigger conditions
- 7 specialized agents (architect, builder, context-engineer, orchestrator,
  qa, reviewer, sre)
- `docs/` directory with 15 knowledge base documents
- `hooks.yaml` — project-level hook configuration
- `scripts/install.mjs` — harness installer/checker script
- GitHub Actions workflows: `harness-hooks.yml`, `doc-gardening.yml`

### Changed

- `handlers/responses.ts` — 15 unprotected `console.log` calls migrated to
  `log.debug()` (IS_DEBUG-gated); `<think>` tag warnings use `log.warn()`
- `request.ts`, `handlers/models.ts` — IS_DEBUG-gated console.log/error calls
  migrated to `log.debug()`
- `.claude/settings.json` — updated script paths from `.claude/skills/` to
  `.agents/skills/` (12 occurrences)
- Renamed `test/architecture.spec.ts` → `test/architecture.test.ts` for Vitest
  discovery

### Fixed

- Double-directory drift between `.claude/` and `.agents/` — `.agents/` now
  single source of truth
- Type assertion cleanup in test files (27 locations)
- Architecture boundary tests for layer dependency validation
