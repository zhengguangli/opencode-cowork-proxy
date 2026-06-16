---
name: quality-gate
description: 'Quality review gate. Code review, architecture compliance, taste validation, test verification, architecture boundary checks. Triggers on explicit requests: "运行质量审查", "执行 quality gate", "代码审查", "质量检查", "review code". Do NOT trigger when discussing general quality.'
capabilities: ["review", "architecture", "testing", "lint"]
---

# Quality Gate

## Core Philosophy

**Taste is encodable.** Transform subjective preferences into mechanically checkable rules. Review feedback must include specific fix instructions, not vague suggestions.

## Execution Flow

### Step 1: Load review standards

Load from these sources:
- `docs/ARCHITECTURE.md` — Architecture constraints
- `docs/QUALITY_SCORE.md` — Taste invariants
- `docs/SECURITY.md` — Security requirements

### Step 2: Architecture compliance review

| Check | Method |
|--------|------|
| Dependency direction | Static analysis of import/require statements |
| Layer boundaries | translate(pure) → handlers → providers → routing → config |
| translate/ purity | No fetch(), fs.*, or I/O in translate/ modules |
| Provider/Translator interfaces | Entry point checks for cross-cutting concerns |
| Circular dependencies | Dependency graph analysis |

### Step 3: Taste validation

| Dimension | Check Content |
|------|----------|
| Naming | handle* for handlers, format* for translators, FormatPairKey enum |
| Logging | Structured logging via src/logger.ts |
| Types | No `any`, minimal `as` casts, no `@ts-ignore` |
| Size | Source files ≤500 lines, test files ≤1000 lines |
| Duplication | Shared utilities over hand-crafted helpers |

### Step 3.5: Language-adapted check intensity

This project uses TypeScript + Zod v4. Focus on:
- Avoid `any`, type assertions, `as` casts
- Zod v4 runtime validation at boundaries (validate.ts)
- No `@ts-ignore` / `@ts-expect-error` without documented reason

### Step 4: Security review (API gateway specific)

| Check | Severity |
|--------|----------|
| Auth bypass on POST endpoints | Critical |
| Upstream URL injection (X-Upstream-Url) | Critical |
| Header smuggling | High |
| Secret leakage in error responses | Critical |
| Input validation (body size + Zod) | High |
| Rate-limit header exposure | Medium |

### Step 5: Agent readability review

- Does the code have sufficient context information
- Are names self-explanatory (handle*, format*)
- Are there implicit dependencies (relying on human memory)
- Has external knowledge been encoded into the repo

### Step 6: Generate review report

```markdown
## Quality Gate Report

**Overall Assessment:** {Pass/Fail/Conditional Pass}

### Architecture Compliance: {✅/❌}
### Taste Validation: {✅/❌}
### Security Review: {✅/❌}
### Agent Readability: {✅/❌}

### Fix Instructions
1. {file path}:{line number} — {specific fix action}
```

## Architecture Boundary Scripts

Migrated from architecture-guard. Located in `quality-gate/scripts/`:

| Script | Purpose |
|--------|---------|
| `check-layers.mjs` | Dependency direction validation (customized for project layer structure) |
| `check-naming.mjs` | Naming convention checks (handle*, format*, PascalCase types, etc.) |
| `check-file-size.mjs` | Source ≤500 lines, test ≤1000 lines, config ≤400 lines |
| `check-type-safety.mjs` | Detect `any`, `as` casts, `@ts-ignore`, non-null assertions |

### Quick Start

```bash
node .agents/skills/quality-gate/scripts/check-layers.mjs
node .agents/skills/quality-gate/scripts/check-naming.mjs
node .agents/skills/quality-gate/scripts/check-file-size.mjs
node .agents/skills/quality-gate/scripts/check-type-safety.mjs
```

## Automated Verification

```bash
bun test test/architecture.test.ts   # 127 architecture boundary checks
bun test                             # 521 tests across 28 files
bun run typecheck                    # TypeScript check (0 errors expected)
```

## Verification Checklist

- Agent team verification (6 agents)
- Skill team verification (12 skills)
- Configuration file verification (AGENTS.md, .agents/hooks.yaml, .codex/hooks.json)
- Project test verification (521 tests, 127 architecture checks)
- Script file existence (all referenced scripts exist on disk)

### Quality Standards

| Indicator | Standard | Weight |
|------|------|------|
| Agent team integrity | 100% | 20% |
| Skill team integrity | 100% | 15% |
| Hooks framework availability | 100% | 25% |
| Project test pass rate | 100% | 30% |
| Architecture boundary compliance | 100% | 10% |

**Total Score = Σ(indicator × weight)**

- **Excellent**: 95-100%
- **Good**: 85-94%
- **Pass**: 75-84%
- **Fail**: < 75%

## Input/Output Protocol

**Input:**
- Code changes to review (diff or full files)
- Review standard documents

**Output:**
- Review report
- Pass/fail decision
- List of specific fix instructions
