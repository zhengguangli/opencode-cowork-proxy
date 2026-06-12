<!-- HARNESS-PILOT:START -->

## Architecture Map
- AGENTS.md — main project doc and harness pointer (CLAUDE.md removed)
- Agent definitions: `.agents/agents/` — 7 specialized agents
- Skill definitions: `.agents/skills/` — 14 standard skills
- Install script: `scripts/install.mjs` — unified installer

## Key Constraints
- **Humans steer, agents execute** — engineer designs environment, AI writes code
- **Repo = system of record** — knowledge outside repo doesn't exist to agents
- **Map, not manual** — AGENTS.md is TOC, not encyclopedia
- **Constraints = multipliers** — rigid architecture boundaries enable speed

## Agent Team

| Agent | Role |
|-------|------|
| orchestrator | Team coordinator, manages task dispatch and phase transitions |
| architect | Architecture designer, defines layer boundaries and taste invariants |
| builder | Code generator, produces implementation within constraints |
| reviewer | Quality reviewer, code review and taste validation |
| qa | Verification engineer, testing and trigger checks |
| sre | Site reliability engineer, observability and entropy management |
| context-engineer | Context engineer, knowledge architecture management |

## Skills

| Skill | Purpose |
|-------|---------|
| harness-orchestrator | Team orchestrator, coordinates all agents |
| harness-init | One-click harness init |
| context-setup | Knowledge base architecture generation |
| architecture-guard | Architecture boundary enforcement |
| entropy-gc | Entropy management & garbage collection |
| observability-setup | Observability stack config |
| sandbox-exec | Secure code execution environment |
| quality-gate | Quality review gate |
| agent-readability | Agent readability optimization |
| harness-evolve | Feedback-driven evolution |
| hooks-framework | Deterministic execution hooks |
| web-search | Web search integration |
| mcp-connector | MCP tool connector |
| tool-search | Dynamic tool discovery |

## Navigation
- New project init? Use `harness-init` or `harness-orchestrator` skill
- Architecture design? Read `.agents/agents/architect.md`
- Quality review? Read `.agents/skills/quality-gate/SKILL.md`
- Knowledge management? Read `.agents/skills/context-setup/SKILL.md`
- Evolution feedback? Read `.agents/skills/harness-evolve/SKILL.md`
- Hooks config? Read `.agents/skills/hooks-framework/SKILL.md`
- Web search? Read `.agents/skills/web-search/SKILL.md`
- MCP integration? Read `.agents/skills/mcp-connector/SKILL.md`
- Install? Read `README.md` or run `node scripts/install.mjs --help`
- Sandbox config? Read `docs/SANDBOX.md` or run `.agents/skills/sandbox-exec/scripts/sandbox/run-in-sandbox.sh`
- API endpoints & features? Read `README.md` for the full endpoint reference
- Plugin architecture? Read `src/translate/plugin.ts` — `TranslatorRegistry`, `FormatPair` interfaces
- Provider routing? Read `src/providers.ts` — `ProviderRegistry`, `resolveByPrefix()`
- Observability metrics? Read `src/handlers/metrics.ts` — Prometheus format, 6 metric types
- Audit events? Read `src/audit.ts` — 6 event types, `/audit/log` endpoint
- Request validation? Read `src/validate.ts` — Zod v4 schemas for 3 API formats
- Rate-limit tracking? Read `src/rate-limit.ts` — upstream RateLimit-* header tracking
- Response caching? Read `src/response-cache.ts` — in-memory LRU cache
- Load testing? Run `node scripts/load-test.mjs --help`
- Dependency audit? Run `node scripts/audit-deps.mjs --ci`
- OpenAPI spec? Run `node scripts/generate-openapi.mjs --save`
- CI/CD? Read `.github/workflows/ci.yml` — test + audit dual jobs

<!-- HARNESS-PILOT:END -->
