---
name: architecture-guard
description: 'Enforce architecture boundaries & taste invariants. Generate linter rules, structural tests, CI checks. Triggers on explicit requests: "运行架构检查", "检查边界", "生成 linter 规则", "architecture guard", "强制执行架构". Do NOT trigger when discussing general architecture.'
---

# Architecture Guard — Architecture Boundary Enforcement

## Core Philosophy

**Constraints are accelerators.** By enforcing invariants rather than micromanaging, agents can deliver quickly without weakening the foundation. Encode once, enforce everywhere.

## Execution Flow

### Step 1: Load architecture rules

Load architecture constraints from these sources:
- `docs/ARCHITECTURE.md` — Layered architecture definition
- `docs/QUALITY_SCORE.md` — Taste invariants
- `docs/SECURITY.md` — Security constraints

### Step 2: Generate layered linter

Generate custom linter rules based on architecture definitions:

**Check items:**
- Whether dependency direction is unidirectional (Types → Config → Repo → Service → Runtime → UI)
- Whether cross-cutting concerns enter through Provider interfaces
- Whether direct cross-layer dependencies exist

**Error message format (core design):**
```
[ARCHITECTURE_VIOLATION] {file path}:{line number}
Rule violated: {rule description}
Dependency direction: {current} → {forbidden target}
Fix instruction: {specific action}
```

**Error messages must inject fix instructions — this is key to the agent-first design:**
- Error messages are not for humans; they are for agents
- Agents can directly execute fix instructions upon receiving an error, with no additional reasoning needed
- Fix instructions must be specific enough for mechanical execution (e.g., "change import from service/types to types/user")

**Error message design principles:**
1. **Actionable**: Include explicit fix steps, not vague suggestions
2. **Specific**: File paths, line numbers, variable names must all be exact
3. **Context-aware**: Generate targeted fix instructions based on violation type
4. **Language-aware**: Fix instruction format differs by language (TS uses import, Python uses from...import)

**Example:**
```
[ARCHITECTURE_VIOLATION] src/service/user.ts:15
Rule violated: Service layer must not directly depend on Types layer
Dependency direction: service/user.ts → types/user.ts
Fix instruction: Change `import { User } from '../types/user'` to obtain via Provider interface
```

### Step 3: Generate structural tests

```typescript
// architecture.spec.ts — structural tests to verify architecture boundaries
describe('Architecture boundaries', () => {
  it('Types layer cannot depend on Service layer', () => {
    // Check that files under types/ do not import from service/
  });
  
  it('Cross-cutting concerns enter only through Providers', () => {
    // Check that auth, connectors, etc. are accessed only through Provider interfaces
  });
});
```

### Step 4: Generate CI checks

```yaml
# .github/workflows/architecture-guard.yml
name: Architecture Guard
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run lint:architecture
      - run: npm run test:architecture
```

### Step 5: Taste invariant checks

| Category | Linter Rule |
|------|-------------|
| Structured logging | Detect console.log / print and other unstructured logging |
| Naming conventions | Verify Schema/Type names conform to spec |
| File size | Flag warnings for files exceeding threshold |
| Type safety | Detect any types, type assertions, YOLO-style probing |
| Shared utilities | Detect duplicate helper function implementations |

### Step 6: Package check scripts

Package check rules as independently runnable .mjs scripts (Node.js ESM, cross-platform):

```
architecture-guard/
├── SKILL.md
└── scripts/
    ├── check-layers.mjs       ← Dependency direction check
    ├── check-naming.mjs       ← Naming convention check
    ├── check-file-size.mjs    ← File size check
    └── check-type-safety.mjs  ← Type safety check (TS/Python/Go/Rust)
```

Each script:
- Cross-platform: Node.js ESM, macOS/Linux/Windows compatible
- Dual mode: CLI (`node scripts/check-layers.mjs`) + import (`import { checkLayers }`)
- Input: Project root directory path (`CLAUDE_PROJECT_DIR` / `CODEX_PROJECT_DIR` / `OPENCODE_PROJECT_DIR` / `PROJECT_DIR` env var or cwd)
- Output: Violation report (stderr), always exit 0
- Language-aware: Auto-detect TS/Python/Go/Rust and apply corresponding rules

## Input/Output Protocol

**Input:**
- `docs/ARCHITECTURE.md`
- `docs/QUALITY_SCORE.md`
- `docs/SECURITY.md`
- Project tech stack

**Output:**
- Linter configuration files
- Check scripts under `scripts/` directory
- Structural test files
- CI workflow configuration
- `docs/ARCHITECTURE.md` update (if needed)

## Quality Standards

- Each linter rule includes explicit fix instructions
- Each check script is independently runnable (`node scripts/check-*.mjs`)
- Scripts are cross-platform (Node.js ESM, no external dependencies)
- Structural tests are independently runnable
- CI checks trigger automatically on PR
