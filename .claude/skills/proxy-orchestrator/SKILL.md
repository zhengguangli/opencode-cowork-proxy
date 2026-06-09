---
name: proxy-orchestrator
description: "Orchestrator for all OpenCode Cowork Proxy work — translation, streaming, routing, testing, deployment, code review, performance audit, and investigation-only diagnosis. Handles: adding new upstream models, fixing translation bugs (wrong output, missing fields, mapping errors), debugging streaming hangs, updating routing logic, running tests, deploying to any target (CF/Vercel/binary), running code review before merge, performance auditing for latency/optimization, and investigation-only diagnosis (no code changes). MUST use for: any proxy work request, including follow-ups (rerun, re-execute, update, modify, fix results, improve, deploy again, review again, rollback, or 'still get {wrong behavior}' on previous output). Simple questions about the proxy can be answered directly."
---

# Proxy Orchestrator

## Execution Mode: Hybrid

| Phase | Mode | Rationale |
|-------|------|-----------|
| Diagnosis / Investigation | Sub-agents (fan-out) | Independent parallel analysis by specialists |
| Implementation | Sub-agents (fan-in) | Specialists each own their module; no cross-team communication needed |
| Code Review | Single sub-agent | One reviewer reads diff, produces report |
| QA | Single sub-agent | One QA agent runs tests and cross-references boundaries |
| Cleanup | Direct | You (lead) perform cleanup directly |

---

## Team

| Agent | subagent_type | Role | Skill | Output File |
|-------|--------------|------|-------|------------|
| `translation-specialist` | `translation-specialist` | Field mapping, 9 translators | `field-mapping` | `_workspace/02_translation_changes.md` |
| `streaming-specialist` | `streaming-specialist` | SSE streaming, event lifecycle | `stream-debug` | `_workspace/02_streaming_changes.md` |
| `routing-specialist` | `routing-specialist` | Routing, auth, caching, models | `model-registry` | `_workspace/02_routing_spec.md` |
| `qa-inspector` | `qa-inspector` | Cross-boundary verification | — | `_workspace/04_qa_report.md` |
| `code-reviewer` | `code-reviewer` | Correctness, security, style | `field-mapping`, `stream-debug` | `_workspace/03_review_report.md` |
| `deployment-manager` | `deployment-manager` | CF/Vercel/binary, CI/CD | `deployment` | `_workspace/05_deploy_report.md` |

**All Agent calls MUST use `model: "opus"`.**

---

## Workflows

### Phase 0: Context Check

Check `.workspace/` to determine execution mode:
- **Does not exist** → Initial execution. Proceed to Phase 1.
- **Exists + user requests partial modification** → Partial re-execution. Re-call only the relevant agent(s).
- **Exists + new input** → New execution. Move `.workspace/` to `.workspace_prev/`, then proceed.

### 0: Initial Setup (every workflow)

1. Create `_workspace/` directory at project root
2. Load relevant skills (`field-mapping`, `stream-debug`, `model-registry`, `deployment`) as needed
3. Determine which agents to spawn based on the request type

### 1: Add New Upstream Model

**Triggers:** "add model", "new model", "model not found", "update model catalog", "add upstream model"

1. Verify model exists in upstream `/v1/models` via live curl
2. If vision-capable → add to `VISION_CAPABLE_GO` / `VISION_CAPABLE_ZEN` in `src/index.ts`
3. Update README.md model tables
4. Run `bun test`
5. Spawn `deployment-manager` to deploy
6. Update `model-registry` skill catalog tables

### 2: Fix Translation Bug

**Triggers:** "wrong output", "not mapping", "field missing", "translation error", "field X is wrong", "stop reason wrong", "content block wrong"

1. Spawn `translation-specialist` (with `field-mapping` skill loaded) to identify affected file and direction
2. If stream-related → also spawn `streaming-specialist` (with `stream-debug` skill loaded)
3. Implement fix + add regression test
4. Run `bun test`
5. Spawn `code-reviewer` → read `_workspace/03_review_report.md`
6. If review passes → spawn `qa-inspector` → read `_workspace/04_qa_report.md`
7. If QA passes → spawn `deployment-manager`
8. If review or QA fail → route fixes back to specialist, re-review/re-QA (max 2 retries each)

### 3: Investigate-Only (No Code Changes)

**Triggers:** "investigate", "diagnose", "why does X happen", "what's wrong with", "root cause", "find the bug"

1. Spawn `translation-specialist` OR `streaming-specialist` OR `routing-specialist` as appropriate
2. Read workspace files from specialist
3. Report findings to user (no code changes unless explicitly requested)

### 4: Performance Audit

**Triggers:** "performance", "slow", "latency", "optimize", "bottleneck"

1. Spawn `routing-specialist` to audit `src/index.ts` hot path
2. If streaming perf issue → also spawn `streaming-specialist`
3. Implement optimizations
4. Run `bun test`
5. Deploy

### 5: Code Review

**Triggers:** "review", "code review", "PR review", "review my changes"

1. Write diff summary to `_workspace/02_changes.md`
2. Spawn `code-reviewer` as sub-agent (load `field-mapping` and `stream-debug` skills)
3. Read `_workspace/03_review_report.md`
4. Report findings to user with severity counts

### 6: Deployment

**Triggers:** "deploy", "release", "ship", "publish"

1. Write deploy target to `_workspace/05_deploy_target.md`
2. Spawn `deployment-manager` as sub-agent (load `deployment` skill)
3. Read `_workspace/05_deploy_report.md` for status
4. Report deployment result to user

### 7: Vision Model Failure

**Triggers:** "image not working", "vision broken", "force override wrong", "vision model wrong"

1. Read `model-registry` skill
2. Read `getVisionModel()` and `VISION_CAPABLE_GO`/`VISION_CAPABLE_ZEN` in `src/index.ts`
3. Verify model exists on upstream via live curl
4. Implement fix (set update or logic change) + add test
5. Run `bun test`
6. Deploy

---

## Instructions for Sub-Agents

When spawning any specialist, include in the prompt:

```
You are a specialist agent for the OpenCode Cowork Proxy project.

Working directory: /Users/lizhengguang/Documents/Github/opencode-cowork-proxy

IMPORTANT: Use only Read, Grep, Glob, Bash, and Edit tools.
Do NOT spawn additional agents or delegate work.
Return your findings directly.
```

When spawning `code-reviewer` or `qa-inspector`, also include:

```
IMPORTANT: Do NOT make any changes to files. Your role is analysis and review ONLY.
```

---

## Error Handling

| Condition | Action |
|-----------|--------|
| Specialist fails | Restart once. If persists, work directly |
| Review FAIL | Route fixes back to specialist. Re-review max 2 more times |
| QA FAIL | Route fixes back to specialist. Re-test max 2 more times |
| Deploy FAIL | Fix, rebuild, re-deploy |
| 3 consecutive failures | Stop and ask user |

---

## Test Scenarios

| Scenario | Expected Outcome |
|----------|-----------------|
| User: "add claude-opus-4.5" | 1. Verify upstream 2. If vision-capable add to set 3. Update README 4. Test 5. Deploy |
| User: "streaming is broken" | 1. Spawn streaming-specialist 2. Diagnose 3. Fix 4. Test 5. Review → QA → Deploy |
| User: "review the PR" | 1. Read diff 2. Spawn code-reviewer 3. Report findings with severity |
| User: "what's wrong with Responses API images?" | 1. Spawn translation-specialist 2. Investigate only 3. Report findings |
| User: "deploy to Vercel" | 1. Write target 2. Spawn deployment-manager 3. Get status report |
| User: "image not working on /zen" | 1. Load model-registry 2. Check VISION_CAPABLE_ZEN 3. Fix + test + deploy |
