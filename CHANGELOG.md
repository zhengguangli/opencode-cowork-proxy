# Changelog

All notable changes to the opencode-cowork-proxy harness.

## [Unreleased]

### Added
- `src/logger.ts` — structured logger with DEBUG/INFO/WARN/ERROR levels, JSON-per-line output, IS_DEBUG gating
- `docs/` directory with 15 knowledge base documents (ARCHITECTURE.md, DESIGN.md, SECURITY.md, RELIABILITY.md, PLANS.md, PRODUCT_SENSE.md, QUALITY_SCORE.md, FRONTEND.md + subsystem docs)
- `hooks.yaml` — project-level hook configuration
- `scripts/install.mjs` — harness installer/checker script
- 14 standard skills with trigger conditions
- 7 specialized agents (architect, builder, context-engineer, orchestrator, qa, reviewer, sre)
- GitHub Actions workflows: `harness-hooks.yml`, `doc-gardening.yml`

### Changed
- `handlers/responses.ts` — 15 unprotected `console.log` calls migrated to `log.debug()` (IS_DEBUG-gated); `<think>` tag warnings use `log.warn()`
- `request.ts`, `handlers/models.ts` — IS_DEBUG-gated console.log/error calls migrated to `log.debug()`
- `translate/stream/openai-to-anthropic.ts`, `translate/stream/anthropic-to-openai.ts`, `translate/stream/chat-completions-to-responses.ts` — IS_DEBUG-gated console.error calls migrated to `log.debug()`
- `.claude/settings.json` — updated script paths from `.claude/skills/` to `.agents/skills/` (12 occurrences)
- `.github/workflows/harness-hooks.yml`, `doc-gardening.yml` — updated skill paths
- `hooks.yaml` — updated reference path
- Synced `.agents/` → `.claude/` for all agent files (orchestrator.md had drift), 5 SKILL.md files, and 13 hooks scripts
- Renamed `test/architecture.spec.ts` → `test/architecture.test.ts` for Vitest discovery

### Removed
- `src/handlers/health.ts` — unused `IS_DEBUG` import cleaned
- All raw `console.log`/`console.error` calls from handler and translate files — centralized in `src/logger.ts`
- `.claude/skills/.harness-pliot/` — stray runtime data removed

### Fixed
- Double-directory drift between `.claude/` and `.agents/` — `.agents/` now single source of truth
- Type assertion cleanup in test files (27 locations)
- Architecture boundary tests for layer dependency validation
