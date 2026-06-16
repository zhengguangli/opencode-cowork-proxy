---
name: entropy-gc
description: 'Entropy management & garbage collection. Detect code drift, quality degradation, tech debt, open cleanup PRs. Triggers on explicit requests: "运行垃圾收集", "清理代码", "entropy gc", "技术债务扫描", "漂移检测". Do NOT trigger when discussing general cleanup.'
capabilities: ["drift-detection", "quality-scoring", "cleanup"]
---

# Entropy GC — Entropy Management & Garbage Collection

## Core Philosophy

**Entropy is inevitable.** Agents reproduce patterns already present in the repository—including suboptimal ones. Technical debt is like a high-interest loan: small continuous repayments are better than batch processing after accumulation.

## Execution Flow

### Step 1: Load Golden Principles

Load quality standards from the following sources:
- `docs/QUALITY_SCORE.md` — Quality scoring
- `docs/ARCHITECTURE.md` — Architecture constraints
- `docs/SECURITY.md` — Security requirements

### Step 2: Drift Scan

| Scan Dimension | What to Check |
|----------|----------|
| Architecture Drift | Dependency direction violations, layer boundary breaches |
| Pattern Drift | Bad pattern reproduction, duplicate code |
| Documentation Drift | Outdated docs, missing cross-references |
| Tool Drift | Deprecated dependencies, unused tools |
| Taste Drift | Naming inconsistency, non-uniform log formatting |

### Step 3: Quality Scoring

Calculate quality scores for each product domain and architecture layer:

```markdown
## Quality Score: {domain name}

| Dimension | Score (0-10) | Gap Description |
|------|------------|----------|
| Architecture Compliance | 8 | Minor boundary violations |
| Test Coverage | 6 | Core logic 85% |
| Documentation Completeness | 7 | Missing API docs |
| Security | 9 | No known vulnerabilities |
| Maintainability | 7 | 2 overly large files |
```

### Step 4: Generate Cleanup PR

Generate targeted fix PRs for discovered issues:

- Each PR focuses on a single issue
- PR description includes: problem description, fix approach, impact scope
- PRs small enough to review in 1 minute

### Step 5: Update tech-debt-tracker

Record discovered technical debt in `docs/exec-plans/tech-debt-tracker.md`:

```markdown
## Tech Debt Tracker

| ID | Description | Severity | Discovery Date | Status |
|----|------|----------|----------|------|
| TD-001 | {description} | {high/medium/low} | {date} | {to fix/fixing/fixed} |
```

## Input/Output Protocol

**Input:**
- Project codebase
- `docs/QUALITY_SCORE.md`
- `docs/ARCHITECTURE.md`

**Output:**
- Drift scan report
- Quality score updates
- Cleanup PR (if needed)
- `docs/exec-plans/tech-debt-tracker.md` updates

## Runnable Scripts

```
.agents/skills/entropy-gc/
├── SKILL.md
└── scripts/
    ├── drift-scan.mjs    ← Drift scan (architecture, docs, taste, tools)
    └── quality-score.mjs ← Quality scoring (file size, debt, tests, docs)
```

### Quick Start

```bash
# Daily quick scan (architecture drift + doc staleness)
node .agents/skills/entropy-gc/scripts/drift-scan.mjs --quick

# Weekly full scan (all dimensions)
node .agents/skills/entropy-gc/scripts/drift-scan.mjs --full

# Generate quality score
node .agents/skills/entropy-gc/scripts/quality-score.mjs
```

## Automation Configuration

### GitHub Actions (Recommended)

```yaml
# .github/workflows/entropy-gc.yml
name: Entropy GC
on:
  schedule:
    - cron: '0 8 * * *'   # Daily 08:00 UTC — quick scan
    - cron: '0 8 * * 1'   # Weekly Monday 08:00 UTC — full scan
  workflow_dispatch:
      scan_type:
        description: 'Scan type'
        required: true
        default: 'quick'
        type: choice
        options:
          - quick
          - full

permissions:
  contents: write
  pull-requests: write

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Determine scan type
        id: scan
        run: |
          if [[ "${{ github.event_name }}" == "workflow_dispatch" ]]; then
            echo "mode=--${{ github.event.inputs.scan_type }}" >> $GITHUB_OUTPUT
          elif [[ "$(date +%u)" == "1" ]]; then
            echo "mode=--full" >> $GITHUB_OUTPUT
          else
            echo "mode=--quick" >> $GITHUB_OUTPUT
          fi

      - name: Drift scan
        run: |
          node .agents/skills/entropy-gc/scripts/drift-scan.mjs ${{ steps.scan.outputs.mode }}

      - name: Quality score
        if: steps.scan.outputs.mode == '--full'
        run: |
          node .agents/skills/entropy-gc/scripts/quality-score.mjs

      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: entropy-reports
          path: .harness-pilot/drift-scan-*.md
          retention-days: 30

      - name: Create issue on drift
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('.harness-pilot/drift-scan-${{ steps.scan.outputs.mode == '--full' && 'full' || 'quick' }}.md', 'utf8');
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `[entropy-gc] Drift Detection Report ${new Date().toISOString().split('T')[0]}`,
              body: report,
              labels: ['entropy', 'tech-debt']
            });
```

### Local Cron (Optional)

```bash
# crontab -e
# Daily quick scan
0 8 * * * cd /path/to/project && node .agents/skills/entropy-gc/scripts/drift-scan.mjs --quick
# Weekly full scan
0 8 * * 1 cd /path/to/project && node .agents/skills/entropy-gc/scripts/drift-scan.mjs --full && node .agents/skills/entropy-gc/scripts/quality-score.mjs
```
