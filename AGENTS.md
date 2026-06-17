## Architecture Map
- `src/translate/` — pure format translation (no I/O, no fetch, no fs)
- `src/providers.ts` — provider routing and registry
- `src/handlers/` — request pipeline, metrics, streaming
- `src/validate.ts` — Zod v4 request validation
- `src/audit.ts` — audit event logging
- `src/rate-limit.ts` — upstream rate-limit header tracking
- `src/response-cache.ts` — in-memory LRU response cache
- `.claude/` — canonical agent definitions and skills (`.agents/` is legacy mirror)
- `scripts/` — install, load-test, audit-deps, openapi generation

## Key Constraints
- **Humans steer, agents execute** — engineer designs environment, AI writes code
- **translate/ is pure** — no fetch, no fs, no I/O; format logic only
- **Parse-Don't-Validate** at handler boundaries — parse into typed domain objects
- **AGENTS.md ≤ 100 lines** — give a map, not a manual
- **Source files ≤ 500 lines** — split before exceeding

## Agent Team

| Agent | Role |
|-------|------|
| orchestrator | Team coordinator, task dispatch and phase transitions |
| architect | Architecture designer, layer boundaries and taste invariants |
| builder | Code generator, implementation within constraints |
| reviewer | Quality reviewer, code review and taste validation |
| qa | Verification engineer, testing and trigger checks |
| sre | Site reliability, observability and entropy management |
| context-engineer | Knowledge base architect, AGENTS.md and docs/ maintenance |

## Skills

| Skill | Purpose |
|-------|---------|
| format-translation | Anthropic↔OpenAI↔Responses API format bridge |
| provider-routing | Provider registry and prefix-based resolution |
| streaming | SSE streaming patterns and backpressure |
| request-pipeline | Request lifecycle, middleware ordering |
| quality-gate | Quality review gate, code review and taste validation |
| hooks-framework | Deterministic execution hooks (compaction, lint, offload) |
| harness-orchestrator | Team orchestrator, coordinates agent/skill execution |
| harness-init | One-click harness initialization |
| harness-evolve | Feedback-driven harness evolution |
| context-setup | Knowledge base architecture generation |
| entropy-gc | Entropy management and garbage collection |
| agent-readability | Agent readability optimization |
| mcp-connector | MCP server integration (Context7, GitHub API, filesystem) |
| web-search | Web search integration for real-time data beyond training cutoff |
| testing | Testing patterns, 521 tests across 28 files, bun test |
| deployment | Cloudflare Workers + standalone binary deployment |
| security-review | API gateway security review: auth, injection, think-tags |

## Navigation
- New format pair? Read `.claude/skills/format-translation/SKILL.md`
- New provider? Read `.claude/skills/provider-routing/SKILL.md`
- Streaming issue? Read `.claude/skills/streaming/SKILL.md`
- Request flow? Read `.claude/skills/request-pipeline/SKILL.md`
- Quality check? Read `.claude/skills/quality-gate/SKILL.md`
- Translation logic? Read `src/translate/plugin.ts`
- Provider routing? Read `src/providers.ts`
- API endpoints? Read `README.md`
- Observability? Read `src/handlers/metrics.ts`
- Audit events? Read `src/audit.ts`
- Request validation? Read `src/validate.ts`
- Rate-limit tracking? Read `src/rate-limit.ts`
- Response caching? Read `src/response-cache.ts`
- Hooks config? Read `.claude/skills/hooks-framework/SKILL.md`
- MCP integration? Read `.claude/skills/mcp-connector/SKILL.md`
- Web search? Read `.claude/skills/web-search/SKILL.md`
- Install? Run `bun run scripts/install.mjs --help`
- Testing patterns? Read `.claude/skills/testing/SKILL.md`
- Deploy? Read `.claude/skills/deployment/SKILL.md`
- Security review? Read `.claude/skills/security-review/SKILL.md`

> **Note:** `.agents/` remains available as a legacy mirror. `.claude/` is the canonical source.
