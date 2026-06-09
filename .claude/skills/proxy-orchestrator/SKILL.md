---
name: proxy-orchestrator
description: "Orchestrator for all OpenCode Cowork Proxy work — translation, streaming, routing, testing, deployment, code review, and configuration. Handles: adding new upstream models, fixing translation bugs, debugging streaming hangs, updating routing logic, running tests, deploying to any target, running code review, performance auditing, and investigating-only diagnosis. MUST use for: any proxy work request, including follow-ups (rerun, re-execute, update, modify, fix results, improve, deploy again, review again, rollback, or 'still get {wrong behavior}' on previous output)."
---

# Proxy Orchestrator

## Execution Mode: Hybrid

### Diagnosis/Implementation — Fan-Out/Fan-In

```
You (Lead)                    _workspace/
├── Spawn 1-3 specialists ──► 01_diagnosis.md
├── Read results ◄─── specialist results (parallel)
├── Synthesize plan ◄── 01_diagnosis.md
├── Spawn 1-2 specialists ──► 02_changes.md
├── Read results ◄─── specialist results
└── Hand off to review ──► 03_review.md, 04_qa.md
```

### Code Review / QA — Single Sub-Agent

```
You (Lead)                    _workspace/
├── Read 03_review.md ◄── reviewer result
├── Read 04_qa.md ◄── qa-inspector result
├── Gate: if FAIL, route fixes, re-review
└── Merge if PASS ──► 05_deploy.md
```

### Cleanup — Direct

You (Lead) performs cleanup tasks directly.

---

## Team

| Agent | Role | Use for |
|-------|------|---------|
| `translation-specialist` | Anthropic↔OpenAI, Responses↔Chat Completions | Any translation task |
| `streaming-specialist` | SSE streaming, event lifecycle | Streaming issues |
| `routing-specialist` | Routing, auth, caching, model override | Routing changes |
| `qa-inspector` | Cross-boundary integration verification | Pre-merge QA |
| `code-reviewer` | Correctness, security, style | Pre-merge review |
| `deployment-manager` | CF Workers, Vercel, binary, CI/CD | Any deploy |

**All Agent calls MUST use `model: "opus"`.**

---

## Workflows

### 1. Add New Upstream Model

**Triggers:** "add model", "new model", "model not found", "update model catalog"

**Steps:**
1. Verify model exists in upstream `/v1/models` (live curl)
2. If vision-capable → add to `VISION_CAPABLE_GO` / `VISION_CAPABLE_ZEN`
3. Update README.md model tables
4. `bun test`
5. Deploy
6. Update `model-registry` skill catalog tables

### 2. Fix Translation Bug

**Triggers:** "wrong output", "not mapping", "field missing", "translation error"

**Steps:**
1. Spawn `translation-specialist` to identify affected file/direction
2. Spawn `streaming-specialist` if stream-related
3. Implement fix + add regression test
4. `bun test`
5. Code review → QA → deploy

### 3. Investigate-Only (No Code Changes)

**Triggers:** "investigate", "diagnose", "why does X happen", "what's wrong with"

**Steps:**
1. Spawn `translation-specialist` OR `streaming-specialist`
2. Read workspace files
3. Report findings to user (no code changes unless explicitly requested)

### 4. Performance Audit

**Triggers:** "performance", "slow", "latency", "optimize"

**Steps:**
1. Spawn `routing-specialist` to audit `index.ts` hot path
2. Spawn `streaming-specialist` if streaming perf issue
3. Implement optimizations
4. `bun test`
5. Deploy

### 5. Code Review

**Triggers:** "review", "code review", "PR review"

**Steps:**
1. Write diff to `02_changes.md`
2. Spawn `code-reviewer` as sub-agent
3. Read `03_review.md`
4. Report findings

### 6. Deployment

**Triggers:** "deploy", "release", "ship"

**Steps:**
1. Write deploy target to `05_deploy.md`
2. Spawn `deployment-manager` as sub-agent
3. Read `05_deploy.md` for status

### 7. Vision Model Failure

**Triggers:** "image not working", "vision broken", "force override wrong"

**Steps:**
1. Read `model-registry` skill
2. Read `getVisionModel()` in `src/index.ts`
3. Check `VISION_CAPABLE_GO` / `VISION_CAPABLE_ZEN` sets
4. Implement fix + test

---

## Workspace Files

All agents write to `_workspace/` files for sub-agent coordination:

| File | Purpose | Writers | Readers |
|------|---------|---------|---------|
| `01_diagnosis.md` | Root cause analysis | All specialists | Lead |
| `02_changes.md` | Code changes made | All specialists | Lead, reviewer, QA |
| `03_review.md` | Code review verdict | `code-reviewer` | Lead |
| `04_qa.md` | Integration test results | `qa-inspector` | Lead |
| `05_deploy.md` | Deployment status | `deployment-manager` | Lead |

## Error Handling

| Condition | Action |
|-----------|--------|
| Specialist fails | Restart once. If persists, work directly |
| Review FAIL | Route fixes. Re-review max 2 more times |
| QA FAIL | Route fixes. Re-test max 2 more times |
| Deploy FAIL | Fix, rebuild, re-deploy |
| 3 consecutive failures | Stop. Ask user |

## Test Scenarios

| Scenario | Expected |
|----------|----------|
| User: "add claude-opus-4.5" | 1. Verify upstream 2. If vision-capable, add to set 3. Update README 4. Test 5. Deploy |
| User: "streaming is broken" | 1. Identify direction 2. Spawn streaming-specialist 3. Fix 4. Test 5. Deploy |
| User: "review the PR" | 1. Read diff 2. Spawn code-reviewer 3. Report |
| User: "what's wrong with" | 1. Spawn specialist 2. Investigate 3. Report |
| User: "deploy" | 1. Write target 2. Spawn deployment-manager 3. Deploy |

---

## Instructions for Sub-Agents

When spawning any specialist, always include in the prompt:

```
You are a specialist agent for the OpenCode Cowork Proxy project.

IMPORTANT: Use only the Read, Grep, Glob, Bash, and Edit tools.
Do NOT spawn additional agents or delegate work.
Return your findings directly.

Working directory: /Users/lizhengguang/Documents/Github/opencode-cowork-proxy
```

When spawning `code-reviewer` or `qa-inspector`, also include:

```
IMPORTANT: Do NOT make any changes to files. Your role is analysis and review ONLY.
```
