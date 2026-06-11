<!-- HARNESS-PILOT:START -->

## Harness: opencode-cowork-proxy

**Goal:** Bidirectional AI API translation gateway — Anthropic ↔ OpenAI format bridge, deployed on Cloudflare Workers.

**Trigger:** When work involves feature implementation, bug fixes, testing, or deployment of the proxy, use the corresponding skills. Answer simple questions directly.

### Architecture Map

- [AGENTS.md](AGENTS.md) — main project doc and harness pointer
- Agent definitions: `.agents/agents/` (7 specialized agents)
- Skill definitions: `.agents/skills/` (14 standard skills)
- Install script: `scripts/install.mjs` — unified installer
- Architecture docs: `docs/ARCHITECTURE.md`

### Core Principles

1. **Humans steer, agents execute** — engineer designs environment, AI writes code
2. **Repo = system of record** — knowledge outside repo doesn't exist to agents
3. **Map, not manual** — AGENTS.md is TOC, not encyclopedia
4. **Constraints = multipliers** — rigid architecture boundaries enable speed

### Quick Links

| Purpose | Reference |
|---------|-----------|
| Agent team | `.agents/agents/` |
| Skills | `.agents/skills/` |
| Architecture | `docs/ARCHITECTURE.md` |
| Knowledge base | `docs/` |
| Codex hooks | `.codex/hooks.json` |
| Claude hooks | `.claude/settings.json` |
| CI hooks | `.github/workflows/harness-hooks.yml` |
| Doc freshness | `.github/workflows/doc-gardening.yml` |

<!-- HARNESS-PILOT:END -->

### Change History

| Date | Change | Target | Reason |
|------|--------|--------|--------|
| 2026-06-11 | Initial harness setup | Full | Harness Engineering initialization |
| 2026-06-11 | Sync `.agents/` → `.claude/` | agents, skills, scripts | Double-directory drift cleanup; unify on `.agents/` as SOT |
| 2026-06-11 | Update config paths | `.claude/settings.json`, CI workflows | Reference `.agents/skills/` instead of `.claude/skills/` |
| 2026-06-11 | Remove stray `.claude/skills/.harness-polit/` | cleanup | Residual runtime data under skill tree |
| 2026-06-11 | Logging refactor | `src/logger.ts`, handlers, streams | Structured logger with JSON-per-line output; 15 unprotected console.log fixed; centralized logging

