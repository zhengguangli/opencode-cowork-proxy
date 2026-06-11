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



<!-- HARNESS-PILOT:END -->
