---
name: context-setup
description: 'Generate and maintain project knowledge architecture. Creates AGENTS.md, docs/, domain docs. Triggers on explicit requests: "初始化知识库", "生成 AGENTS.md", "创建文档结构", "context setup", "搭建知识库". Do NOT trigger when discussing general documentation.'
---

# Context Setup — Knowledge Base Architecture Generation

## Core Philosophy

**Give a map, not a manual.** AGENTS.md is a table of contents, not an encyclopedia. The repo is the system of record — knowledge outside the repo does not exist to agents.

**The filesystem is the most fundamental Harness primitive.** The filesystem provides agents with:
- **Persistent storage**: Work can be incrementally added and offloaded, rather than all held in context
- **Collaboration surface**: Multiple agents and humans coordinate work through shared files (Agent Teams depend on this mechanism)
- **State persistence**: Maintain state across sessions, enabling long-running tasks
- **Version control**: Git adds version tracking to the filesystem, supporting rollback of errors and branch experimentation

## Execution Flow

### Step 1: Knowledge audit

1. Scan existing project documentation (README, docs/, wiki, etc.)
2. Identify existing knowledge and gaps
3. Determine the context characteristics of target AI tools

### Step 2: Generate AGENTS.md

AGENTS.md must be a table-of-contents style, containing:

```markdown
# AGENTS.md

## Project Overview
{2-3 sentence description of project purpose and core functionality}

## Architecture Map
- See [ARCHITECTURE.md](ARCHITECTURE.md)
- Layering rules: Types → Config → Repo → Service → Runtime → UI

## Key Constraints
- Boundary parsing: Parse, Don't Validate → See [docs/SECURITY.md](docs/SECURITY.md)
- Taste invariants → See [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md)
- Security requirements → See [docs/SECURITY.md](docs/SECURITY.md)

## Toolchain
- Build: {build_command}
- Test: {test_command}
- Deploy: {deploy_command}

## Navigation Guide
- New feature? Read [ARCHITECTURE.md](ARCHITECTURE.md) first
- Security related? Read [docs/SECURITY.md](docs/SECURITY.md)
- Quality standards? Read [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md)
- Execution plans? Read [docs/exec-plans/](docs/exec-plans/)
```

**Constraint: no more than 100 lines.** The original text specifies "about 100 lines" — this is a hard constraint — exceeding it squeezes out context space for tasks and code.

### Step 3: Create docs/ directory structure

```
docs/
├── design-docs/
│   └── index.md
├── exec-plans/
│   ├── active/           ← Currently active execution plans
│   ├── completed/        ← Completed execution plans (archived)
│   └── tech-debt-tracker.md ← Tech debt tracker
├── generated/
├── product-specs/
│   └── index.md
├── references/
├── DESIGN.md
├── FRONTEND.md
├── PLANS.md
├── PRODUCT_SENSE.md
├── QUALITY_SCORE.md
├── RELIABILITY.md
└── SECURITY.md
```

**exec-plans/ is a first-class citizen:**
- **active/**: Stores currently executing plan files; agents check for unfinished tasks on startup
- **completed/**: Archived completed plans, used for tracing decision history
- **tech-debt-tracker.md**: Continuously updated tech debt inventory; entropy-gc scan results are written here

**Plan file lifecycle:**
1. Create → `exec-plans/active/{plan-name}.md`
2. In progress → Agent updates progress status in real time
3. Complete → Move to `exec-plans/completed/{plan-name}.md`
4. Debt discovered → Record in `tech-debt-tracker.md`

**FRONTEND.md content template:**

FRONTEND.md is the core constraint document for frontend development, preventing agents from generating cookie-cutter "AI Slop" interfaces.

```markdown
## Font System
- Primary font: {custom font name} (loaded from Google Fonts / local)
- Monospace font: {e.g. JetBrains Mono, Fira Code}
- No default stacks: Do not use Inter, Roboto, Arial, system-ui as the primary font

## Color System (CSS Variables)
- Primary: --primary: #XXXXXX
- Accent: --accent: #XXXXXX
- Background: --bg: gradient/texture definition
- Text: --text-primary / --text-secondary
- No purple gradient + white background default color scheme

## Animation Specification
- Page load: Meaningful entrance/reveal animations (staggered reveal)
- Interaction: Explicit transition durations and easing functions
- No indiscriminate micro-motion piling

## Layout Constraints
- Responsive breakpoints: mobile / tablet / desktop
- Component spacing system
- No template layouts (Hero + 3-column cards + CTA pattern)

## Component Specification
- Projects with existing design systems: Strictly follow established patterns
- New projects: Define a clear visual direction, avoid interchangeable UI patterns
```

### Step 4: Generate skeleton documents

Generate skeleton content for each document, including:
- Title and purpose description
- Chapter structure to be filled in
- Placeholder markers (`<!-- TODO: ... -->`)

### Step 5: Configure freshness checks

Generate `.github/workflows/doc-gardening.yml` or equivalent configuration:
- Periodically scan for stale documents
- Check consistency between documentation and code
- Auto-create fix PRs

## Input/Output Protocol

**Input:**
- Project root directory path
- Tech stack information
- Existing documentation list

**Output:**
- `AGENTS.md`
- `docs/` directory and skeleton documents
- Document freshness check configuration

### Step 6: Context Rot protection

**Context Rot** is one of the core challenges in agent systems. When the context window fills up, the model's reasoning ability and task completion quality degrade significantly — repetition, omissions, inconsistencies, and other issues follow.

**Core insight:** Context is a scarce resource. One of Harness's primary responsibilities is to protect the context window, ensuring agents maintain high-quality reasoning throughout their work.

**Detection signals:**
- Context usage >80%
- Agent output quality degradation (repetition, omissions, inconsistencies)
- Same issues recurring
- Agent starts "forgetting" early constraints or decisions

**Protection measures:**
1. **Progressive disclosure**: Skills are loaded on demand, not fully injected at startup
2. **Document minimalism**: Every piece of information must justify its context footprint
3. **AGENTS.md ≤100 lines**: When exceeding, must split into docs/
4. **Regular audits**: Scan for context injections no longer needed, proactively remove
5. **Tool Offload**: Large tool outputs automatically offloaded to filesystem (see hooks-framework)
6. **Compaction**: Intelligent compression when context nears capacity (API-native or script-based)
7. **Skills progressive loading**: On-demand injection via front-matter, avoiding full loading at startup

### Step 7: Web Search and MCP tool configuration

The model's knowledge is cut off at the training date. Configure search tools to obtain real-time information:

| Tool | Purpose | Configuration |
|------|------|------|
| Web Search | Query latest docs, version info | Built-in or API |
| Context7 | Query latest library versions and docs | MCP server |
| GitHub API | Query issues, PRs, code search | MCP server |

Record available search tools and when to use them in AGENTS.md.

### Step 8: Semantic file search

**Difference from grep:**
- `grep` / `rg`: Regex matching, suitable for precise symbol/string searches
- Semantic search: Understands intent, suitable for fuzzy queries like "find the code that handles timeout retry"

**Configuration tools (recommend Context7 or equivalent):**

```json
{
  "name": "file_search",
  "description": "Semantically search the codebase. Understands natural language query intent, returns the most relevant files and code snippets.",
  "parameters": {
    "query": "Natural language description (e.g. 'where is the error retry logic implemented')",
    "max_results": "Max results returned (default 5)",
    "include": "File patterns filter (e.g. '*.ts')",
    "path": "Search scope (default: project root)"
  }
}
```

**When to use:**
- When a new agent joins a project, quickly understand code structure
- Search for "implementations of similar functionality" (grep cannot match intent)
- Find relevant context during code review
- Assess impact scope before refactoring

**Configuration method:**
- MCP-based semantic search server (recommended)
- Local embeddings + vector database (offline option)
- Integrate into `context-setup` knowledge audit flow, auto-index project code

## Quality Standards

- AGENTS.md ≤ 100 lines (hard constraint)
- All documents include clear "when to read this file" guidance
- No duplicate information (each piece of information appears in only one place)
- All cross-references are valid
- Context Rot protection measures configured
- Search tools available and documented in AGENTS.md
