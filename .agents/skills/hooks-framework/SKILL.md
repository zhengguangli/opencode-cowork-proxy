---
name: hooks-framework
description: 'Hooks/middleware framework. Deterministic execution hooks: compaction, continuation, lint checks. Triggers on explicit requests: "配置 hooks", "设置中间件", "hooks framework", "执行钩子", "配置确定性检查". Do NOT trigger when discussing general hooks.'
---

# Hooks Framework — Deterministic Execution Hooks

## Core Philosophy

**Harness is not just a tool, but also a guarantee of deterministic execution.** Hooks inject deterministic logic at key points in the agent execution cycle, compensating for model non-determinism.

## Architecture

```
hooks.yaml (declarative layer: abstract event names)
    ↓
install.mjs (adaptation layer: translate to each tool's native format)
    ↓
├── .claude/settings.json    → Claude Code native hooks
├── .codex/hooks.json        → Codex native hooks
└── .opencode/plugins/       → OpenCode native plugins

scripts/ (execution layer: .mjs scripts, universal across all three tools)
```

## Core Mechanisms

### Tool Offload

**Problem:** Large tool outputs (e.g. test results, logs, file lists) quickly fill the context window, causing context rot.

**Solution:** When tool output exceeds the threshold (default 2000 characters), automatically offload to filesystem, retaining only head/tail references.

**How it works:**
1. Detect tool output size
2. Exceeds threshold → write full content to `.harness-polit/offloaded/`
3. Return summary: first 20 lines + last 10 lines + file path reference
4. Model can view full content via `cat` command

**Advantages:**
- Protects context window from being polluted by large outputs
- Preserves accessibility of full information
- Supports progressive disclosure: view full content on demand

### Context Cleanup (File Reference Tracking & Auto Offload)

**Problem:** File content read by the agent stays in context indefinitely, consuming precious context window even when no longer needed.

**Solution:** Track file references, automatically identify offloadable files based on TTL, and provide cleanup suggestions during compaction.

**How it works:**
1. **Reference Tracking**: `on_tool_output` hook automatically records read files
2. **TTL Detection**: Files unreferenced for more than 5 minutes are marked as offloadable
3. **Cleanup Suggestions**: `on_turn_end` hook generates a list of offloadable files
4. **Compaction Integration**: Automatically removes offloadable file content during compaction

**Configuration parameters:**
```bash
# Environment variables
REF_TTL_MS=300000                # Reference expiry time (default 5 minutes)
HARNESS_WORKSPACE=.harness-polit     # Workspace dir (default: {project}/.harness-polit)
```

**@ref Marking Mechanism:**
```markdown
# AGENTS.md
Architecture details → @ref:docs/ARCHITECTURE.md
```
- Automatically tracked when agent reads files
- Use `@ref:` markers to explicitly declare references
- Automatically marked as offloadable when reference expires

**Advantages:**
- Automatically frees context space no longer needed
- Seamlessly integrates with compaction
- Reduces Context Rot risk

### Apply Patch (Code Editing Tool)

**Problem:** Models need to edit files in a precise, controllable way, rather than rewriting entire files or using unstable search-and-replace.

**Principle:** Based on OpenAI Codex's `apply_patch` tool standard implementation; models are post-trained on unified diff format.

**Tool Schema:**

```json
{
  "type": "apply_patch",
  "path": "file path",
  "diff": "patch content in unified diff format"
}
```

**Integration with hooks:**
- `on_file_edit` hook automatically triggers `apply-patch.mjs` to validate patch format
- Pre-application checks: file existence, line offset tolerance, conflict detection
- On failure, returns specific error line numbers and suggested fixes
- Supports generating `.harness-polit/patches/` to record all patch history for rollback

**Best Practices (from OpenAI Codex Prompting Guide):**
- Prefer apply_patch for single-file edits
- Do not use apply_patch for auto-generated changes (e.g. `package.json`, `gofmt` output)
- Use scripting approach for cross-file batch search-and-replace for better efficiency
- Patch format must be unified diff (`@@ -line,count +line,count @@`)

### Fault Tolerance

**Problem:** Long-running agent tasks encounter various transient failures—network jitter, API rate limiting, sandbox timeouts—and lack of fault tolerance mechanisms leads to entire task failure.

**Solution:** Three-layer fault tolerance architecture.

**Layer 1: Operation-Level Retry**

Exponential backoff strategy, applicable to tool calls, API requests, file operations:

```
Failure count   Wait time   Action
1st             1s          Retry
2nd             2s          Retry
3rd             4s          Retry
4th             -           Give up, log error
```

**Layer 2: Timeout Control**

| Operation Type | Default Timeout | Timeout Behavior |
|----------|----------|----------|
| Shell Command | 120s | Terminate process, return partial output |
| API Call | 60s | Retry once |
| File Operation | 30s | Error and exit |
| Sandbox Creation | 120s | Rebuild once |

**Layer 3: Circuit Breaker**

Triggered when the same operation type fails >= 5 times within 5 minutes:
1. Pause that operation type for 10 minutes
2. Notify orchestrator to switch to alternative tool
3. Record circuit breaker event to `.harness-polit/metrics/circuit-breaker.log`
4. After 10 minutes, auto half-open probe; restore on success

**Hooks Integration:**
- `on_tool_output` hook detects error codes returned by tools
- `retry-timeout.mjs` manages retry counters and timeout logic
- Circuit breaker state persisted to `.harness-polit/metrics/`, maintained across sessions

### API-Native Compaction vs Script Compaction

**Comparison of two strategies:**

| Dimension | API-Native Compaction | Script Compaction |
|------|----------------------|-----------------|
| Implementation | Calls API built-in `/compact` endpoint | `compaction.mjs` script triggers `PreCompact` hook |
| Efficiency | API co-compresses with model, high fidelity | Independent summarization, may lose key context |
| Compatibility | Only specific APIs (OpenAI Responses API / Claude) | Universal across all models |
| Marking | `encrypted_content` (ZDR compatible) | Filesystem summary file |
| Recommended Scenario | Preferred (if API supports it) | Fallback (when API does not support it) |

**Auto-selection logic:**
```
Check if API supports native compaction
  ├─ Supported → Configure on_compact hook as empty (let API handle it)
  └─ Not supported → Use compaction.mjs script approach
```

Currently defaults to script approach for cross-platform compatibility. When running on APIs that support native compaction (e.g. OpenAI Responses API's `/compact` endpoint or Claude's built-in summarization), it is recommended to disable script compaction to avoid double compression.

### Prompt Caching Guidance

**Core Insight:** Prompt caching is the single largest optimization lever for reducing token consumption and latency, saving 50-90% of repeated context costs.

**Applicable Scenarios:**
- System prompts for all agents (lowest change frequency)
- AGENTS.md injected content (unchanged across sessions)
- Repeatedly used tool definition schemas
- Immutable historical message segments in long conversations

**Hooks Integration:** The `on_session_start` hook automatically marks static content like AGENTS.md as cacheable prefixes, with cache hits automatically managed by the API.

## Abstract Event Mapping

| Abstract Event | Claude Code | Codex | OpenCode |
|----------|-------------|-------|----------|
| `on_session_start` | `SessionStart` | `SessionStart` | `session.created` |
| `on_file_edit` | `PostToolUse(Edit\|Write)` | `PostToolUse(Edit\|Write)` | `file.edited` |
| `on_apply_patch` | `PostToolUse(apply_patch)` | `PostToolUse(apply_patch)` | `tool.executed(apply_patch)` |
| `on_tool_output` | `PostToolUse(*)` | `PostToolUse(*)` | `tool.executed` |
| `on_compact` | `PreCompact` | `PreCompact` | `experimental.session.compacting` |
| `on_turn_end` | `Stop` | `Stop` | `session.idle` |
| `on_error` | `PostToolUse(*, error)` | `PostToolUse(*, error)` | `tool.executed(error)` |

## Runnable Scripts

```
.agents/skills/hooks-framework/
├── SKILL.md
├── hooks.yaml               ← Unified configuration
├── opencode-plugin.ts       ← OpenCode plugin template
└── scripts/
    ├── context-check.mjs     ← AGENTS.md freshness check
    ├── env-verify.mjs        ← Environment readiness check
    ├── lint-check.mjs        ← Architecture boundary check
    ├── test-run.mjs          ← Test suite execution
    ├── continuation.mjs      ← Ralph Loop continuation detection
    ├── compaction.mjs        ← Context compaction
    ├── tool-offload.mjs      ← Tool output offloading
    ├── context-cleanup.mjs   ← File reference tracking & auto offload
    ├── apply-patch.mjs       ← Apply Patch: patch validation & application
    ├── retry-timeout.mjs     ← Fault tolerance: retry count + timeout + circuit breaker
    ├── trace-log.mjs         ← Execution logging
    ├── todo-sync.mjs         ← Todo state synchronization
    └── quality-metric.mjs    ← Quality metrics
```

### Script Dual-Mode

Each .mjs supports two invocation modes:

**CLI Mode** (Claude Code / Codex hooks invocation):
```bash
node scripts/context-check.mjs
# stdin JSON + exit code + stdout
```

**Import Mode** (OpenCode plugin invocation):
```typescript
import { contextCheck } from './scripts/context-check.mjs'
const result = contextCheck(projectDir)
```

## Quick Start

### Manual Execution

```bash
node .agents/skills/hooks-framework/scripts/context-check.mjs
node .agents/skills/hooks-framework/scripts/lint-check.mjs
# Tool output offloading (JSON input)
echo '{"tool_output":"Large output content...","tool_name":"test"}' | node .agents/skills/hooks-framework/scripts/tool-offload.mjs
```

### install.mjs Auto-Generation

```bash
# Claude Code
node scripts/install.mjs --tool claude   → Generate .claude/settings.json hooks

# Codex
node scripts/install.mjs --tool codex    → Generate .codex/hooks.json

# OpenCode
node scripts/install.mjs --tool opencode → Generate .opencode/plugins/harness-hooks.ts

# All
node scripts/install.mjs --tool all      → Generate all three
```

## Input/Output

**Output Directories:**
- `.harness-polit/trace/` — Execution logs
- `.harness-polit/metrics/` — Quality metrics
- `.harness-polit/context_summary.md` — Compaction summary
- `.harness-polit/continuation_prompt.md` — Continuation prompt
- `.harness-polit/offloaded/` — Offloaded tool outputs (head/tail references + full content)
- `.harness-polit/file-refs.json` — File reference tracking records
- `.harness-polit/unloadable-files.json` — List of offloadable files

## Quality Standards

- Each script can be independently run and tested
- Scripts have no external dependencies (Node.js built-in modules only)
- Universal across three platforms (macOS / Linux / Windows)
- All scripts support both CLI and import dual-mode
- Tool Offload threshold is configurable (default 2000 characters)
