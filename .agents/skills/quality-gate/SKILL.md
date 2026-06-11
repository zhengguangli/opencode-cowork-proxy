---
name: quality-gate
description: 'Quality review gate. Code review, architecture compliance, taste validation, test verification. Triggers on explicit requests: "运行质量审查", "执行 quality gate", "代码审查", "质量检查", "review code". Do NOT trigger when discussing general quality.'
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
- `docs/DESIGN.md` — Design specifications

### Step 2: Architecture compliance review

| Check | Method |
|--------|------|
| Dependency direction | Static analysis of import/require statements |
| Layer boundaries | Compare directory structure with architecture definition |
| Provider interfaces | Entry point checks for cross-cutting concerns |
| Circular dependencies | Dependency graph analysis |

### Step 3: Taste validation

| Dimension | Check Content |
|------|----------|
| Naming | Do variable/function/file names follow conventions |
| Logging | Is structured logging used |
| Types | any types, type assertions, type safety |
| Size | Are files/functions too long |
| Duplication | Is there duplicate code that could be extracted as shared utilities |

### Step 3.5: Language-adapted check intensity

Adjust check intensity based on project tech stack. **Parse, Don't Validate** is implemented differently across languages:

| Language | Type Safety | Parse, Don't Validate Implementation | Check Focus |
|------|----------|---------------------------|----------|
| TypeScript | Strong | Zod/Valibot runtime validation + type inference | Avoid `any`, type assertions, `as` casts |
| Rust | Strong | Compile-time checks + Result error handling | Avoid `unwrap()`, `panic!`, `unsafe` |
| Go | Medium | Explicit error handling + interface constraints | Avoid `interface{}`, ignoring errors |
| Python | Weak | Pydantic/dataclasses + type annotations | Use type hints, avoid passing dicts directly |
| JavaScript | Weak | Runtime validation libraries + JSDoc | Use TypeScript or Zod |

**Strengthen checks for dynamic languages:**

```
For Python/JS/Ruby projects → Increase weight of the following checks:
- Runtime validation (Pydantic/Zod/Joi)
- Type annotation coverage
- Data parsing at boundaries
- Implicit type conversions

For static languages (TS/Rust/Go) → Standard checks are sufficient
```

### Step 4: Security review

| Check | Severity |
|--------|----------|
| Input validation | High |
| SQL injection | Critical |
| XSS | High |
| Sensitive info leakage | Critical |
| Dependency vulnerabilities | Medium-High |

### Step 5: Agent readability review

Check whether future AI agents can reason about the business domain directly from the code:

- Does the code have sufficient context information
- Are names self-explanatory
- Are there implicit dependencies (relying on human memory rather than code documentation)
- Has external knowledge been encoded into the repo

### Step 6: Generate review report

```markdown
## Quality Gate Report

**Overall Assessment:** {Pass/Fail/Conditional Pass}

### Architecture Compliance: {✅/❌}
- {Results}

### Taste Validation: {✅/❌}
- {Results}

### Security Review: {✅/❌}
- {Results}

### Agent Readability: {✅/❌}
- {Results}

### Fix Instructions
1. {file path}:{line number} — {specific fix action}
2. ...
```

## Input/Output Protocol

**Input:**
- Code changes to review (diff or full files)
- Review standard documents

**Output:**
- Review report
- Pass/fail decision
- List of specific fix instructions

## Quality Standards

- Each review comment comes with a specific fix instruction
- Rejection must explain the reason and the fix path
- Review report should be understandable within 1 minute

## Automated Verification

### Verification Script

Use `harness-verify.mjs` for cross-platform automated quality checks:

```bash
# Run in the target project
cd /path/to/your/project
node /path/to/harness-polit/skills/quality-gate/harness-verify.mjs

# Or specify a target directory
node harness-verify.mjs /path/to/your/project
```

**Cross-platform support:** macOS / Linux / Windows (no bash required)

### Verification Checklist

See `VERIFICATION_CHECKLIST.md`, which includes:
- Core component verification (ReAct, Tool Offload, Browser, File System)
- Hooks framework verification (9 scripts)
- Agent team verification (7 agents)
- Skill team verification (14 skills)
- Configuration file verification (CLAUDE.md, AGENTS.md, settings.json)
- Project test verification (unit tests)

### Quality Standards

| Indicator | Standard | Weight |
|------|------|------|
| Core component integrity | 100% | 30% |
| Hooks framework availability | 100% | 25% |
| Agent team integrity | 100% | 20% |
| Skill team integrity | 100% | 15% |
| Project test pass rate | 100% | 10% |

**Total Score = Σ(indicator × weight)**

- **Excellent**: 95-100%
- **Good**: 85-94%
- **Pass**: 75-84%
- **Fail**: < 75%
