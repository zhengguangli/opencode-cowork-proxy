---
name: harness-evolve
description: 'Feedback-driven Harness evolution. Collect feedback, improve agents/skills/knowledge. Triggers on explicit requests: "改进 harness", "演进 harness", "harness evolve", "收集反馈", "优化 agent 团队". Do NOT trigger when discussing general improvements.'
---

# Harness Evolve — Feedback-Driven Evolution

## Core Philosophy

**Harness is an evolving system, not a one-time artifact.** Collect feedback after each execution, continuously improve agents, skills, and knowledge base.

## Execution Flow

### Step 1: Feedback Collection

After each harness execution, ask the user:

1. "Which parts of the results need improvement?"
2. "Do the agent team composition or workflow need adjustment?"
3. "Have you noticed any mistakes the agents repeatedly make?"

**Do not insist on feedback, but always provide the opportunity.**

### Step 2: Feedback Classification & Routing

| Feedback Type | Modification Target | Example |
|----------|----------|------|
| Output Quality | Corresponding agent's skill | "Analysis too shallow" → Add depth criteria in skill |
| Agent Role | Agent definition `.md` | "Need security review" → Add new agent |
| Workflow | Orchestrator skill | "Verification should be earlier" → Adjust phase order |
| Team Composition | Orchestrator + agents | "These two can be merged" → Merge agents |
| Trigger Missing | Skill description | "This expression didn't trigger" → Expand description |

### Step 3: Incremental Modification

**Modification Principles:**
- Change one place at a time
- Verify immediately after modification
- Record the reason for the change

**Modification Process:**
1. Locate the target file to modify
2. Read existing content
3. Make minimal modification
4. Verify the modification is effective
5. Update CHANGELOG.md change history

### Step 4: Change History

Record in the CHANGELOG.md change history table:

```markdown
**Change History:**
| Date | Change | Target | Reason |
|------|--------|--------|--------|
| 2026-01-01 | Initial configuration | All | - |
| 2026-01-05 | Added security review agent | agents/security.md | Feedback: output lacked security review |
| 2026-01-10 | Expanded trigger description | skills/quality-gate | "Check quality" did not trigger |
```

### Step 5: Evolution Triggers

**Situations where proactive evolution suggestions are made:**
- Same type of feedback repeats 2+ times
- Agent repeated failure patterns discovered
- User observed manual operations bypassing orchestrator
- New tech stack or tools introduced
- Terminal Bench 2.0 score decline

### Step 6: Evaluation Benchmark

**Terminal Bench 2.0 Automation:**

Use Terminal Bench 2.0 to evaluate harness configuration effectiveness:

| Evaluation Dimension | Description | Weight |
|----------|------|------|
| Task Completion Rate | Ratio of successfully completed tasks | 40% |
| Code Quality | Correctness and maintainability of generated code | 30% |
| Execution Efficiency | Time and tokens consumed to complete tasks | 20% |
| Error Recovery | Ability to recover from errors | 10% |

**Automated Evaluation Process:**
1. Select standard test task sets from Terminal Bench 2.0
2. Run under current harness configuration: `node .agents/skills/harness-evolve/scripts/run-benchmark.mjs`
3. Automatically collect scores and bottleneck analysis
4. Generate comparison report (current vs historical scores)
5. Automatically trigger evolution suggestions when scores decline

**Key Insight:** The same model performs significantly differently across different harnesses. Opus 4.6 scores much lower in Claude Code than in other harnesses. Continuously optimizing harness is key to improving agent performance.

### Step 7: Operations/Maintenance Workflow

Perform systematic checks, modifications, and synchronization on existing harness:

1. **Status Audit**: Compare agent/skill files against orchestrator definitions for consistency
2. **Incremental Modification**: Add, remove, or change per user requests; synchronize immediately after each modification
3. **Update History**: Record changes in CHANGELOG.md
4. **Change Verification**: Structural check + trigger verification (if triggers are affected)

### Step 8: Trace Self-Analysis

**Purpose:** Analyze agent execution traces to identify and fix harness-level failure patterns.

**Analysis Process:**
1. Load the most recent N execution logs from `.harness-pliot/trace/`
2. Scan for failure patterns:
   - Same error type appearing repeatedly
   - Certain tool calls consistently timing out → may need timeout adjustment or alternative tool
   - Certain phases frequently interrupted → may need increased context or step decomposition adjustment
   - Same file repeatedly edited → possible context rot
   - Agent repeatedly failing at the same step → may need prompt or tool adjustment
3. Generate failure pattern report, auto-route to corresponding target:
   - Tool issues → Adjust `hooks-framework` scripts
   - Phase issues → Adjust `harness-orchestrator` orchestration
   - Context issues → Adjust `context-setup` or compaction strategy
   - Prompt issues → Adjust agent definition files
4. Propose fix suggestions (including specific file:line numbers)

**Automated Triggers:**
- Run automatically after each harness execution
- Accumulated 3 identical error patterns → Proactively notify user
- Terminal Bench score decline >10% → Mandatory full-chain analysis

### Step 9: Dynamic Tool Assembly (Evolution Direction)

**Core Insight:** Current harness uses a pre-configured model—tools and context are determined at startup. The future trend is dynamically assembling the most suitable tools and context based on the specific task at hand.

**Evolution Path:**

| Stage | Model | Description |
|------|------|------|
| Current | Pre-configured | Load all tools and skills at startup |
| Near-term | On-demand loading | Selectively load tools based on task type |
| Future | Dynamic assembly | Assemble optimal tool set in real-time based on task |

**Implementation Approach:**
1. **Task Classifier**: Analyze user requests, identify required capabilities (code generation, testing, browser, search, etc.)
2. **Tool Selector**: Select optimal combination from available tool pool
3. **Context Injector**: Only inject task-relevant context and skills
4. **Feedback Loop**: Adjust tool selection strategy based on execution results

**Current Preparations:**
- Add `capabilities` tags in skill front-matter (e.g. `["code-gen", "testing", "browser"]`)
- Implement simple task→tool mapping in orchestrator
- Collect historical data on task types and tool usage

**Value:** Reduce context footprint, improve agent response speed, lower token consumption.

### Step 9: Harness A/B Testing

**Purpose:** Compare effectiveness of different harness configurations to select the optimal approach.

**A/B Testing Process:**
1. Define Harness variants:
   ```
   Variant A: Current configuration (baseline)
   Variant B: Modify one dimension (e.g. add apply_patch tool)
   ```
2. Run both variants in parallel on the same task set
3. Compare metrics:
   | Metric | Measurement Method |
   |------|----------|
   | Task Completion Rate | Terminal Bench score |
   | Token Consumption | Total + per-operation average |
   | Execution Time | Wall clock time |
   | Error Recovery Count | Extracted from trace |
   | User Correction Count | Extracted from feedback |
4. Generate comparison report (`.harness-pliot/benchmark/comparison.html`)
5. Variant B outperforms A → Suggest merge; underperforms A → Analyze cause

**Configurable Variant Dimensions (independently A/B testable):**
- Tool set (add/remove a tool)
- Compaction strategy (threshold, summarization method)
- Parallelism (number of sub-agents)
- reasoning_effort level

## Input/Output Protocol

**Input:**
- User feedback
- Execution logs
- Current harness configuration

**Output:**
- Modified agent/skill files
- Updated CHANGELOG.md change history
- Evolution report

## Quality Standards

- Record reason for each change
- Verify consistency after changes
- Do not introduce new conflicts
- Change history is complete and traceable
