---
name: proxy-orchestrator
description: "Orchestrator for all OpenCode Cowork Proxy work — translation (Anthropic↔OpenAI AND OpenAI Responses API↔Chat Completions), streaming (all 3 SSE formats), routing, model management, testing, deployment, code review, investigation-only diagnosis, performance audit, and configuration. Handles adding models, fixing translation bugs, debugging streaming hangs, updating routing, running tests, deploying to Cloudflare / Vercel / standalone binary, running code review, and impact analysis. Use for any proxy work request, including follow-ups: rerun, re-execute, update, modify, fix results, improve, deploy again, review again, rollback, or 'still get {wrong behavior}' on previous output."
---

# OpenCode Cowork Proxy Orchestrator

Coordinates the proxy agent team across all proxy-related work. Five workflows cover the common cases; one bespoke mode (investigate-only) is preserved for analysis without commitment to a fix.

## Model Parameter Reminder

**All `Agent` tool calls MUST include `model: "opus"`.** Harness quality is directly tied to agent reasoning capability, and opus guarantees the highest quality. This applies to every phase of every workflow.

## Execution Mode: Hybrid (per phase)

| Phase | Mode | Why |
|-------|------|-----|
| Phase 0 (Context Check) | Direct | Simple state inspection, no orchestration needed |
| Phase 1 (Diagnosis) | Sub-agents in parallel | Independent scoping — each specialist reads its own files |
| Phase 2 (Implementation) | Sub-agents in parallel | Independent implementation, file-based coordination via `_workspace/` |
| Phase 3 (Code Review) | Single sub-agent | One reviewer evaluates all changes for static issues |
| Phase 4 (Verification) | Single sub-agent | QA runs `bun test` and cross-boundary verification |
| Phase 5 (Cleanup) | Direct | Synthesize and report, no orchestration needed |

We deliberately do NOT use the full agent-team pattern (`TeamCreate` + `SendMessage`) — the team coordination overhead exceeds the benefit for this size of work. Sub-agents with file-based coordination are simpler and faster.

---

## Agent Team

| Agent | Type | Role | Loaded Skills |
|-------|------|------|---------------|
| `translation-specialist` | `translation-specialist` | Field mapping for all 3 format pairs | `field-mapping` |
| `streaming-specialist` | `streaming-specialist` | SSE event sequencing, streaming state machines | `stream-debug` |
| `routing-specialist` | `routing-specialist` | Path routing, auth, caching, vision model forcing | `model-registry` |
| `qa-inspector` | `qa-inspector` | Cross-boundary integration verification (general-purpose) | `field-mapping`, `stream-debug` |
| `code-reviewer` | `code-reviewer` | Correctness, security, type safety, test coverage | `field-mapping`, `stream-debug` |
| `deployment-manager` | `deployment-manager` | CF Workers / Vercel / binary deploy, CI/CD, LaunchAgent | `deployment`, `model-registry` |

**Critical agents that must use specific types:**
- `qa-inspector` MUST use `general-purpose` (read-only `Explore` cannot run `bun test` or construct mock streams)
- `code-reviewer` may use `general-purpose` (needs Grep, Read, AND the ability to read the diff)
- Other specialists can use their matching built-in type or `general-purpose`

---

## Phase 0: Context Check (Always Run First)

1. Check if `_workspace/` exists in the working directory
2. Determine execution mode:
   - **`_workspace/` does not exist** → Initial execution. Proceed to Phase 1.
   - **`_workspace/` exists + user requests partial modification** (e.g., "fix only the streaming issue") → Partial re-execution. Skip Phase 1, jump to relevant sub-section of Phase 2.
   - **`_workspace/` exists + user provides new input** → New execution. Move existing `_workspace/` to `_workspace_{YYYYMMDD_HHMMSS}/`, then proceed to Phase 1.
   - **User asks for follow-up** ("still broken", "rerun the fix") → Read the latest `_workspace/04_qa_report.md` to understand current state, then decide:
     - Same root cause? Re-call the relevant specialist with the specific failure mode.
     - New failure mode? Run Phase 1 (parallel diagnosis) again.

---

## Workflow: Fix / Feature (Default)

### Phase 1: Parallel Diagnosis

**Spawn the relevant specialists in parallel** (skip unaffected ones):

| Issue type | Spawn |
|------------|-------|
| Field mapping, response shape, content block handling | `translation-specialist` |
| Streaming hang, truncation, malformed events, `<think>` leakage | `streaming-specialist` |
| Model override, vision forcing, routing path, auth, cache | `routing-specialist` |
| Configuration, deploy failure, env var, port, model availability | `deployment-manager` |
| Unknown / cross-cutting | Spawn all 4 |

Each agent writes a diagnosis to `_workspace/01_{specialist}_diagnosis.md` containing:
- Root cause
- Affected files (with line numbers)
- Proposed fix approach
- Test impact (which existing tests will need updates, what new tests to add)

### Phase 2: Parallel Implementation

Spawn the affected specialists as **parallel sub-agents** (use `Agent` tool with `run_in_background: true` if available, or sequential parallel calls):

1. Each reads its Phase 1 diagnosis
2. Implements the fix in `src/translate/`, `src/index.ts`, `src/auth.ts`, `src/cache.ts`, or other relevant files
3. Adds or updates test cases in `test/`
4. Writes an implementation summary to `_workspace/02_{specialist}_changes.md`

**Coordination rules:**
- `translation-specialist` → if change affects streaming event shapes, write the new schema to `_workspace/02_event_schema.md` for `streaming-specialist`
- `streaming-specialist` → if a change requires new field mappings, request them from `translation-specialist` by writing to `_workspace/02_field_mapping_request.md`
- `routing-specialist` → if a routing change selects a different translator path, write the new spec to `_workspace/02_routing_spec.md`
- **Do not** modify each other's files — coordinate via the workspace files

### Phase 3: Code Review

Spawn `code-reviewer` as a single sub-agent. It:
- Reads all `_workspace/02_*.md` files
- Reviews the diff (`git diff main..HEAD` or working tree)
- Generates `_workspace/03_review_report.md` with severity-classified findings

**Decision:**
- CRITICAL or HIGH → go back to Phase 2 for fixes
- Only MEDIUM or LOW → proceed to Phase 4 (QA may catch the same issues)

### Phase 4: Verification (QA)

Spawn `qa-inspector` as a single sub-agent (use `general-purpose` type). It:
- Reads all updated source files + the review report
- Runs the full test suite: `bun test`
- Performs cross-boundary verification per the qa-inspector checklist
- Generates `_workspace/04_qa_report.md` with:
  - Pass/fail/unverified counts per checklist section
  - `bun test` output (pass: N / fail: N)
  - File:line references for any failures
  - Recommended fixes for any failures

**Decision:**
- Test failures → identify which specialist(s) need to fix → loop back to Phase 2
- Cross-boundary issues → notify affected specialists → loop back to Phase 2
- All clean → proceed to Phase 5

### Phase 5: Cleanup & Report

1. Preserve `_workspace/` for audit trail (do not delete)
2. Report to user:
   - What changed (files, lines)
   - Review result (critical/high/medium/low counts)
   - Test results (pass/fail counts)
   - QA report summary
   - Any next steps or known limitations

---

## Workflow: Investigate Only (No Fix)

Use when the user wants to understand an issue without committing to a fix. Examples:
- "What's wrong with the streaming on this model?"
- "Investigate the token counting"
- "Why is `/v1/responses` returning 500?"
- "Is this a real bug or am I misreading the code?"

**Steps:**
1. Phase 0 (Context Check)
2. Phase 1 only (parallel diagnosis) — specialists write findings
3. **Stop.** Do not proceed to Phase 2.
4. Present findings with severity classifications and recommended fixes
5. Wait for user decision: "fix it", "skip", "fix only #3", etc.

**Why this exists:** Diagnosis is often cheap (read code, no edits) and answers "should I even fix this?". Without a dedicated workflow, users get either a half-baked fix when they wanted analysis, or no analysis because the orchestrator jumped straight to implementation.

---

## Workflow: Performance Audit

Use when the user asks for a performance review, a recent commit mentions perf, or `cache.ts` / streaming latency becomes a concern.

**Steps:**
1. Phase 0 (Context Check)
2. Phase 1 (Parallel Perf Review) — spawn in parallel:
   - `code-reviewer` → `_workspace/01_perf_audit.md` (redundant parsing, O(n²) loops, unnecessary clones, missing `await`, stream backpressure)
   - `qa-inspector` → `_workspace/01_perf_qa.md` (double translation, redundant upstream fetches, missing cache hits, latency budgets)
   - `routing-specialist` → `_workspace/01_perf_routing.md` (path-prefix lookup cost, `routeConfig()` allocation, auth/cache overhead per request)
3. Phase 2 (Synthesis) — orchestrator ranks findings by: hot path frequency × latency impact × fix cost
4. Phase 3 (Recommended Fixes) — present ranked findings; user chooses which to apply
5. Phase 4 (Implementation, if user approves) — feed approved findings into the Fix/Feature flow as Phase 2 input

---

## Workflow: Add New Model

Use when adding a new model to the proxy. Examples: "Add `qwen3.7-max` to the Go path", "Register `big-pickle` as a free model on Zen", "Make `ring-2.6-1t-free` available".

**Steps:**
1. Phase 0 (Context Check)
2. Phase 1 (Routing Spec) — `routing-specialist`:
   - Verifies the model exists in the upstream list (use the `model-registry` skill)
   - Determines routing target (`/go`, `/zen`, or both)
   - Identifies model-specific quirks (vision, thinking, rate limits)
   - Writes `_workspace/01_routing_spec.md`
3. Phase 2 (Documentation) — `routing-specialist` updates README.md model tables
4. Phase 3 (Code Updates) — if the model requires special handling (e.g., vision forcing), `routing-specialist` updates `src/index.ts` (`getVisionModel()` function)
5. Phase 4 (Deploy) — `deployment-manager` runs `bun test`, deploys to targets, verifies
6. Phase 5 (Cleanup) — preserve `_workspace/`, update `model-registry` skill with the new model entry

**Important:**
- Update `model-registry` skill so other agents know the new model exists
- Vision-capable models added to `/zen` may need to be added to the `getVisionModel()` map
- Models added to BOTH upstreams (e.g., `qwen3.6-plus` is on both) don't need a `getVisionModel()` update

---

## Workflow: Deployment Only

Use for: deploy requests, build failures, CI/CD issues, LaunchAgent setup.

**Steps:**
1. `deployment-manager` reads the `deployment` skill for step-by-step instructions
2. Determine target(s): Cloudflare Workers / Vercel / standalone binary / all three
3. For each target: `bun test` → deploy → verify with `curl` on the deployed URL
4. For config changes (upstream URLs, model lists, env vars, port):
   - Edit the relevant config file
   - Update README.md and `model-registry` skill
   - Verify with `bun test` or build
5. Report deploy status, configuration impact, and any issues

---

## Workflow: Code Review Only

Use when the user wants a review of changes (current diff or specific files) without committing to follow-up work.

**Steps:**
1. Identify scope: current working tree diff, specific files, or full codebase
2. `code-reviewer` reads the diff, evaluates per its checklist
3. Review report written to `_workspace/03_review_report.md`
4. Present severity-classified findings
5. If the user wants fixes, transition to Fix/Feature workflow Phase 2

---

## Data Flow

```
Fix/Feature Flow:
  [Issue] → Phase 0 (context) → Phase 1 (parallel diagnose) → Phase 2 (parallel implement)
    → Phase 3 (review) → Phase 4 (QA + bun test) → Phase 5 (cleanup + report)

Investigate Flow:
  [Issue] → Phase 0 → Phase 1 → STOP (wait for user decision)

Performance Audit Flow:
  [Perf request] → Phase 0 → Phase 1 (3 parallel perf reviews) → Phase 2 (synthesize)
    → Phase 3 (recommend) → Phase 4 (optional Fix/Feature)

Add Model Flow:
  [New model] → Phase 0 → Phase 1 (routing spec) → Phase 2 (docs) → Phase 3 (code)
    → Phase 4 (deploy) → Phase 5 (update model-registry)
```

## Error Handling

| Situation | Strategy |
|-----------|----------|
| 1 specialist can't reproduce the issue | Document uncertainty, proceed with implementation from other specialists' findings |
| QA finds a failing test | Check review report for the same finding; route to the right specialist with the test output; fix; re-verify |
| Code review finds CRITICAL | Block QA, fix first, re-review, then QA |
| Timeout | Use current partial results; report what's complete and what isn't |
| `bun test` has pre-existing failures | Document as pre-existing; verify new code doesn't add new failures |
| Implementation too large for one session | Save `_workspace/`, flag incomplete items for the next session |
| Deploy failure mid-pipeline | Report the failure with error details; suggest next action (rollback, fix, retry) |
| Specialist outputs conflict | The orchestrator synthesizes; surface the conflict in the cleanup report for user decision |

---

## Test Scenarios

### Normal Flow: Adding a new translator field
1. User describes the new field and its expected format in all 3 formats
2. Phase 1: `translation-specialist` maps the field; `streaming-specialist` evaluates delta events
3. Phase 2: Both implement request/stream/response translation
4. Phase 3: `code-reviewer` reviews for correctness and test coverage
5. Phase 4: QA runs `bun test` and cross-verifies end-to-end
6. All tests pass → summary

### Error Flow: Debugging a streaming hang
1. User reports streaming hangs with specific model/endpoint
2. Phase 1: `streaming-specialist` identifies missing `content_block_stop` in OpenAI→Anthropic direction
3. Phase 2: `streaming-specialist` fixes the block sequence; `translation-specialist` checks field mapping
4. Phase 3: `code-reviewer` verifies the block lifecycle is correct
5. Phase 4: QA runs stream test with the exact payload shape, reproduces hang, verifies fix
6. If QA fails → loop back to Phase 2

### Deployment Flow: Add a new model and deploy
1. User asks to add `ring-2.6-1t-free` to Zen
2. Phase 1: `routing-specialist` verifies upstream support, writes routing spec
3. Phase 2: README.md model table updated
4. Phase 3: `routing-specialist` updates `model-registry` skill
5. Phase 4: `deployment-manager` runs `bun test`, deploys, verifies
6. Summary reported with deploy URL and model availability

### Code Review Flow: Review a routing change
1. User asks to review current routing changes
2. `code-reviewer` reads the diff, checks model override chain, error handling, auth flow
3. Review report generated with severity-classified findings
4. Findings presented to user for action

### Investigate Flow: Diagnose why images cause errors
1. User reports "when I use images, I get errors" (no fix requested yet)
2. Phase 1: `routing-specialist` inspects vision model forcing; `translation-specialist` inspects image block translation
3. Specialists write findings — e.g., "hardcoded VISION_MODEL doesn't match /zen catalog"
4. **STOP.** Present findings with severity and recommended fix.
5. User decides whether to proceed to Fix/Feature flow

### Performance Audit Flow: Audit translator latency
1. User asks for a performance review
2. Phase 1: `code-reviewer` + `qa-inspector` + `routing-specialist` run in parallel
3. Findings ranked by hot path frequency × latency impact × fix cost
4. User picks which to apply; approved findings feed into Fix/Feature Phase 2

### Vision Model Failure Flow: Free promotion ends
1. User reports image requests fail with "Free promotion has ended" error
2. Phase 1: `routing-specialist` reads `model-registry`, identifies the failed model
3. Phase 2: `routing-specialist` updates `getVisionModel()` to a working alternative
4. Phase 3: `code-reviewer` verifies the change
5. Phase 4: `qa-inspector` runs regression tests, verifies routing decisions
6. Phase 5: Report fix + suggest `deployment-manager` redeploy

---

## Description Follow-up Keywords (Aggressive Triggering)

The description is the only trigger mechanism. It MUST include follow-up expressions to handle re-runs, modifications, and rollbacks:

- "fix streaming hang", "debug streaming", "stream not working", "stream truncated"
- "add model", "new model", "update model list", "register model"
- "fix translation", "wrong field", "field mapping bug", "shape mismatch"
- "deploy", "deployment", "update config", "change upstream", "Cloudflare", "LaunchAgent", "Vercel"
- "build", "binary", "standalone"
- "review", "code review", "review changes", "audit", "perf audit"
- "add test", "fix test", "test failing"
- "fix the response", "results are wrong", "still broken"
- "rerun the fix", "re-execute", "redeploy", "deploy again", "rollback", "revert"
- "investigate", "diagnose", "why is {X} happening", "what's wrong with {Y}"
- Recurring expressions: "same bug with {other-model}", "still get {wrong behavior}"
