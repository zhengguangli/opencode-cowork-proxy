---
name: harness-init
description: 'Initialize Harness Engineering from scratch. One-click gen of agents, skills, knowledge architecture, CLAUDE.md. MUST trigger on explicit init requests: "初始化 harness", "配置 agent 团队", "搭建 harness", "harness init", "部署 harness". For updates use harness-orchestrator.'
capabilities: ["init", "configuration", "scaffolding"]
---

# Harness Init — One-Click Initialize Harness Engineering System

## Core Philosophy

**One-click deployment, zero-friction startup.** The Harness Engineering system should be as simple as `npm install`—complete deployment of agents, skills, and knowledge base with a single command. Incremental injection without overwriting existing content ensures seamless integration with existing projects.

## Trigger Conditions

Triggered when the user requests configuring a complete agent team and harness system for the project.

## Execution Flow

### Phase 1: Project Discovery

1. Scan project root, identify tech stack (package.json / Cargo.toml / go.mod / pyproject.toml etc.)
2. Identify existing directory structure and code organization
3. Detect target AI tools (claude-code / codex / opencode)
4. Check if `.claude/`, `.agents/`, `.opencode/` directory already exists (avoid overwriting)

### Phase 2: Architecture Design

Invoke `architect` agent:

1. Design layered architecture rules based on tech stack
2. Define taste invariants (naming, logging, file size, type safety)
3. Generate `docs/ARCHITECTURE.md`
4. Generate linter rule configuration

### Phase 3: Knowledge Base Construction

Invoke `context-engineer` agent:

1. Generate `AGENTS.md` (table-of-contents style, ~100 lines)
2. Create `docs/` directory structure
3. Generate skeleton docs for each domain (DESIGN.md, SECURITY.md, RELIABILITY.md etc.)
4. Configure knowledge freshness checks

### Phase 4: Skill Generation

Invoke `builder` agent:

Select and customize from the following standard skill packages based on project needs:

| Skill | Purpose | Required |
|------|------|------|
| context-setup | Knowledge base architecture management | ✅ |
| architecture-guard | Architecture boundary enforcement | ✅ |
| entropy-gc | Drift detection & garbage collection | ✅ |
| observability-setup | Observability stack configuration | Optional |
| sandbox-exec | Secure code execution | Optional |
| quality-gate | Quality review gate | ✅ |
| agent-readability | Agent readability optimization | Optional |
| harness-evolve | Feedback-driven evolution | ✅ |
| hooks-framework | Deterministic execution hooks | ✅ |

### Phase 5: Hooks Configuration

Based on `.agents/skills/hooks-framework/hooks.yaml` template, generate project-customized hooks configuration:

1. Copy `hooks.yaml` to project root
2. Adjust check rules in `lint-check.mjs` based on project tech stack
3. Adjust test commands in `test-run.mjs` based on project test framework
4. Configure CI integration (`.github/workflows/harness-hooks.yml`)

**hooks.yaml Core Configuration:**

```yaml
hooks:
  pre_execution:
    - name: context-check    # Check AGENTS.md freshness
    - name: env-verify       # Verify environment readiness
  post_execution:
    - name: lint-check       # Architecture boundary check
    - name: test-run         # Run tests
  interception:
    - name: continuation     # Ralph Loop continuation
    - name: compaction       # Context compaction
  observation:
    - name: trace-log        # Execution logging
    - name: quality-metric   # Quality metrics
```

### Phase 6: Quality Review

Invoke `reviewer` agent:

1. Check all agent definition completeness
2. Check all skill frontmatter
3. Check CLAUDE.md pointer correctness
4. Check knowledge base cross-references

### Phase 7: Verification

Invoke `qa` agent:

1. Structural verification: file locations, formats, references
2. Trigger verification: each skill's should-trigger + should-NOT-trigger
3. Dry-run verification: orchestrator phase sequence logicality

### Phase 8: Register CLAUDE.md

Generate CLAUDE.md at project root, register harness pointer. Do NOT include change history — use docs/CHANGELOG.md instead (loaded on demand to save context tokens).

```markdown
## Harness: {Project Name}

**Goal:** {One-sentence description}

**Trigger:** When work requests involve {domains}, use corresponding skills. Answer simple questions directly.

Change history → @ref:docs/CHANGELOG.md
```

## Output Checklist

- [ ] `.agents/agents/` — 7 agent definition files
- [ ] `.agents/skills/` — Standard skill packages
- [ ] `CLAUDE.md` — Harness pointer
- [ ] `docs/` — Knowledge base directory structure and skeleton docs
- [ ] `docs/ARCHITECTURE.md` — Architecture map
- [ ] `hooks.yaml` — Project-customized execution hook configuration
- [ ] `.github/workflows/harness-hooks.yml` — CI hooks integration
- [ ] `.github/workflows/doc-gardening.yml` — Documentation freshness check

## References

- Architecture design: `references/architecture-template.md`
- Knowledge base templates: `references/docs-template.md`
