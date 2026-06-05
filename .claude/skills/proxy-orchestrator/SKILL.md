---
name: proxy-orchestrator
description: "Orchestrator for all OpenCode Cowork Proxy work — translation (Anthropic↔OpenAI AND OpenAI Responses API↔Chat Completions), streaming (all 3 SSE formats), routing, testing, deployment, code review, investigation-only diagnosis, performance audit, and configuration. Handles adding models, fixing translation bugs, debugging streaming hangs, updating routing, running tests, deploying to Cloudflare, building standalone binary, managing LaunchAgent, running code review, and impact analysis. Follow-up: rerun, re-execute, update, modify, fix results, improve, deploy again, review again based on previous output."
---

# OpenCode Cowork Proxy Orchestrator

Orchestration skill that coordinates the proxy agent team to handle all proxy-related work: translation fixes (Anthropic↔OpenAI AND OpenAI Responses API↔Chat Completions), streaming debugging (all 3 SSE formats), routing changes, deployment, configuration, code review, performance audit, investigation-only diagnosis, and model management.

## Model Parameter Reminder

Per the harness skill's Phase 3 requirement, **all Agent tool calls must include `model: "opus"`**. Harness quality is directly tied to agent reasoning capability, and opus guarantees the highest quality. This applies to all phases of every workflow below.

## Execution Mode: Hybrid

| Phase | Mode | Reason |
|-------|------|--------|
| Phase 1 (Diagnosis) | Sub-agents | Parallel scoping — each specialist independently diagnoses the issue |
| Phase 2 (Implementation) | Sub-agents | Parallel implementation coordinated via file-based transfer (no team; sub-agents write to `_workspace/` and read each other's notes) |
| Phase 3 (Code Review) | Sub-agents | Independent review before QA — code-reviewer evaluates correctness, security, type safety |
| Phase 4 (Verification) | Sub-agents | QA agent independently verifies with objectivity |
| Phase 5 (Cleanup) | Direct | Synthesize results, no orchestration needed |

## Agent Composition

| Member | Agent Type | Role | Skills | Output |
|--------|-----------|------|--------|--------|
| translation-specialist | built-in (`translation-specialist`) | Request/response field mapping | field-mapping | Updated translator source files |
| streaming-specialist | built-in (`streaming-specialist`) | SSE streaming event sequencing | stream-debug | Updated stream translator files |
| routing-specialist | built-in (`routing-specialist`) | Path routing, auth, caching, config | — | Updated routing/auth/cache logic |
| qa-inspector | built-in (`qa-inspector`) | Integration cross-boundary verification | — | Verification report |
| code-reviewer | built-in (`code-reviewer`) | Code correctness, security, type safety review | field-mapping, stream-debug (conditional) | Review report with severity classifications |
| deployment-manager | built-in (`deployment-manager`) | Build, deploy, CI/CD, config management | deployment | Deployed Worker/binary, updated configs |

## Workflow Selection

Determine the execution path based on the user's request:

| Request Type | Execute Path |
|-------------|-------------|
| Bug fix / new feature | Full flow: Diagnosis → Implementation → Review → QA → Cleanup |
| Code review only | Skip to Phase 3 (Code Review) |
| Deployment / config change | deployment-manager solo (with deployment skill) |
| Model update | routing-specialist + deployment-manager (see "Add New Model" workflow) |
| Add new translator | translation-specialist + streaming-specialist + code-reviewer + qa-inspector |
| **Investigate / diagnose only** (no fix) | Phase 1 only (parallel diagnosis); user reviews findings, then chooses fix or no-op |
| **Performance audit** | code-reviewer (perf checklist) + qa-inspector (boundary perf) + cache.ts inspection |

---

## Workflow: Fix / Feature (Complete Flow)

### Phase 0: Context Check

Check existing workspace state to determine execution mode:

1. Check if `_workspace/` directory exists
2. Determine execution mode:
   - **`_workspace/` does not exist** → Initial execution. Proceed to Phase 1
   - **`_workspace/` exists + user requests partial modification** → Partial re-execution. Only re-call the relevant specialist(s), overwrite only the modified output
   - **`_workspace/` exists + new input provided** → New execution. Move existing `_workspace/` to `_workspace_{YYYYMMDD_HHMMSS}/`, then proceed to Phase 1
   - **User asks for follow-up** → Check if the issue is in the same area (re-call same specialist) or a new area (run full flow)

### Phase 1: Diagnosis

**Execution Mode:** Sub-agents (parallel scoping)

Run affected specialists in parallel to scope the issue:

| Agent | Input | Output |
|-------|-------|--------|
| translation-specialist | Issue description + relevant payloads | `_workspace/01_translation_diagnosis.md` |
| streaming-specialist | Issue description + stream traces | `_workspace/01_streaming_diagnosis.md` |
| routing-specialist | Issue description + routing config | `_workspace/01_routing_diagnosis.md` |

Each agent independently:
1. Reads the affected source files (use `src/translate/`, `src/auth.ts`, `src/cache.ts`, `src/index.ts`)
2. Identifies the root cause
3. Proposes a fix approach
4. Estimates test impact

Select only the specialists relevant to the issue. Do not spawn unaffected specialists.

### Phase 2: Implementation

**Execution Mode:** Sub-agents (parallel implementation, coordinated via file-based transfer)

Spawn affected specialists as parallel agents to implement fixes. Each agent:
1. Reads the Phase 1 diagnosis for their area
2. Implements the fix in the relevant source files (translator, stream, routing, or auth/cache)
3. Adds or updates test cases
4. Saves implementation summary to `_workspace/02_{specialist}_changes.md`

**Coordination rules:**
- translation-specialist: If a change affects streaming event shapes, write the new event schema to `_workspace/02_event_schema.md` for streaming-specialist
- streaming-specialist: If a change requires new field mappings (e.g., new content block type), request them from translation-specialist by writing to `_workspace/02_field_mapping_request.md`
- routing-specialist: If routing config changes affect which translator path is used, write the new routing spec to `_workspace/02_routing_spec.md`
- All agents: For cross-boundary changes (a translator change that also touches streaming), implement your part and leave notes for the downstream agent

**Important:** Do NOT form a team with TeamCreate. Use Agent tool calls with `run_in_background: true` for independent work, or parallel Workflow agent() calls. Use file-based transfer for coordination.

### Phase 3: Code Review

**Execution Mode:** Sub-agents (independent review)

1. Spawn code-reviewer as a sub-agent
2. code-reviewer:
   - Reads all changed source files (review the diff between current state and `_workspace/` implementation notes)
   - Reviews per its checklist: correctness, security, type safety, test coverage, architecture adherence
   - Generates `_workspace/03_review_report.md` with severity-classified findings
3. If CRITICAL or HIGH findings exist → go back to Phase 2 for fixes
4. If only MEDIUM or LOW findings → proceed to Phase 4 (QA may catch the same issues)

### Phase 4: Verification

**Execution Mode:** Sub-agents (objective verification)

1. Spawn qa-inspector as a sub-agent
2. QA agent:
   - Reads all updated source files
   - Runs cross-boundary verification per `qa-inspector`'s checklist
   - Runs `bun test` on all test files
   - Generates `_workspace/04_qa_report.md`
3. Review QA report:
   - If test failures found → identify which specialist(s) need to fix → loop back to Phase 2
   - If cross-boundary issues found → notify the affected specialists → loop back to Phase 2
   - All clean → proceed to Phase 5

### Phase 5: Cleanup

1. Preserve `_workspace/` for audit trail
2. Summarize changes to the user:
   - What was changed (files, lines)
   - Review result (critical/high/medium/low counts)
   - Test results (pass/fail counts)
   - QA report summary
   - Next steps or known limitations

---

## Workflow: Code Review Only

**Execution Mode:** Single agent

1. Identify the scope: What changed? (current git diff, specific files, or the whole codebase)
2. If scope is the current working tree diff:
   - Run `git diff` to get the changes
   - Pass the diff to code-reviewer as input
3. code-reviewer generates `_workspace/03_review_report.md`
4. Present findings with severity classifications
5. If the user wants fixes, transition to Fix/Feature workflow Phase 2

---

## Workflow: Deployment Only

**Execution Mode:** Single agent

1. deployment-manager reads the deployment skill for step-by-step instructions
2. Determine deployment target:
   - **Cloudflare Workers** → Verify tests pass, run `bun run deploy`, verify response
   - **Vercel** → Run `bunx vercel deploy --prod`, verify response at `opencode-cowork-proxy.vercel.app`
   - **Standalone binary** → `bun build --compile`, copy to `/usr/local/bin/`, reload LaunchAgent
   - **All three** → Do Cloudflare → Vercel → binary
3. For config changes (upstream URLs, model lists, dependencies):
   - Make the change in the relevant config file
   - Update README.md if documentation changes are needed
   - Verify with tests or build
4. Report deployment status, configuration impact, and any issues found

---

## Workflow: Investigate Only (Diagnosis, No Fix)

**Execution Mode:** Sub-agents (parallel scoping)

Use when the user wants to understand an issue without committing to a fix. Examples: "What's wrong with the streaming on this model?", "Investigate the token counting", "Why is /v1/responses returning 500?".

### Steps

1. **Phase 0: Context Check** — same as Fix/Feature flow
2. **Phase 1: Parallel Diagnosis** — spawn the relevant specialist(s):
   - Translation issue → `translation-specialist` writes `_workspace/01_translation_diagnosis.md`
   - Streaming issue → `streaming-specialist` writes `_workspace/01_streaming_diagnosis.md`
   - Routing/config issue → `routing-specialist` writes `_workspace/01_routing_diagnosis.md`
   - Performance issue → `code-reviewer` writes `_workspace/01_perf_audit.md`
3. **Stop** — do not proceed to Phase 2 (Implementation) unless the user explicitly requests a fix
4. **Present findings** to the user with severity classifications and recommended fixes
5. **Wait for user decision** — user can say "fix it", "skip", "fix only #3", etc.

### Why This Exists

Diagnosis is often cheap (read code, no edits) and answers "should I even fix this?". Without a dedicated workflow, users get either a half-baked fix when they wanted analysis, or no analysis because the orchestrator jumped straight to implementation.

---

## Workflow: Performance Audit

**Execution Mode:** Sub-agents (parallel perf-focused)

Use when the user asks for a performance review, a recent commit mentions perf, or `cache.ts` / streaming latency becomes a concern. Examples: "Audit the streaming performance", "Find perf regressions in the last 5 commits", "Is there redundant work in the translator chain?".

### Steps

1. **Phase 0: Context Check** — same as Fix/Feature flow
2. **Phase 1: Parallel Perf Review** — spawn in parallel:
   - `code-reviewer` writes `_workspace/01_perf_audit.md` covering: redundant string parsing, O(n²) loops in hot paths, unnecessary object clones, missing `await` in critical sections, missing stream backpressure
   - `qa-inspector` writes `_workspace/01_perf_qa.md` covering: cross-boundary perf issues (double translation, redundant upstream fetches, missing cache hits), latency budgets per format pair
   - `routing-specialist` writes `_workspace/01_perf_routing.md` covering: path-prefix lookup cost, `routeConfig()` allocation, auth/cache overhead per request
3. **Phase 2: Synthesis** — orchestrator (or main agent) reads the three reports and ranks findings by:
   - Hot path frequency (every request vs cold path)
   - Latency impact (microseconds vs milliseconds)
   - Fix cost (one-line vs refactor)
4. **Phase 3: Recommended Fixes** — present ranked findings to user; user chooses which to apply
5. **Phase 4: Implementation** (if user approves) — feed approved findings into the Fix/Feature flow as Phase 2 input

### Reference

The recent commit `c526148 perf: apply 4 performance optimizations from code review` is an example of this workflow's output (4 perf fixes applied after a comprehensive code review).

---

## Workflow: Add New Model

**Execution Mode:** Sub-agents (routing + deployment)

Use when adding a new model to the proxy. Examples: "Add `qwen3.7-max` to the Go path", "Register `big-pickle` as a free model on Zen", "Make `ring-2.6-1t-free` available".

### Steps

1. **Phase 0: Context Check** — same as Fix/Feature flow
2. **Phase 1: Routing Spec** — `routing-specialist`:
   - Verifies the model exists in the upstream list (opencode.ai/models for Go, opencode.ai/docs/zen for Zen)
   - Determines routing target (`/go`, `/zen`, or both)
   - Identifies any model-specific quirks (vision support, thinking config, rate limits)
   - Writes `_workspace/01_routing_spec.md` with the proposed routing config
3. **Phase 2: Documentation** — `routing-specialist` updates `README.md` model tables
4. **Phase 3: Code Updates** — if the model requires special handling (e.g., vision forcing), `routing-specialist` updates `src/index.ts` (e.g., add to `hasImages` → vision model map)
5. **Phase 4: Deploy** — `deployment-manager` runs tests, deploys, verifies
6. **Phase 5: Cleanup** — preserve `_workspace/`, summarize to user with model availability URL

### Important

- The model list in `README.md` is the user-facing source of truth. Update it even for "obvious" model additions.
- New free models on Zen should also be added to the model override path (`/zen/{model}/v1/messages`) so clients can pin them.
- Vision-capable models must be added to the image-detection → vision-model force map, otherwise clients sending images to a non-vision model will get errors.

---

## Data Flow

```
Fix/Feature Flow:
  [Issue] → Phase 1: parallel(diagnosis)  →  Phase 2: parallel(fix)  
    → Phase 3: code-review  →  Phase 4: qa-verify  →  Phase 5: cleanup

Code Review Flow:
  [Review request] → code-reviewer → review report

Deployment Flow (one or more targets):
  [Deploy request] → deployment-manager → CF Workers / Vercel / binary → status report
```

## Error Handling

| Situation | Strategy |
|-----------|----------|
| 1 specialist can't reproduce the issue | Document uncertainty, proceed with implementation from other specialists' findings |
| QA finds failing test | Check review report for same finding → route to appropriate specialist with specific test output → fix → re-verify |
| Code review finds critical issue | Block QA, fix first, then re-review, then QA |
| Timeout | Use current partial results, report what was completed and what was not |
| bun test has pre-existing failures | Document as pre-existing, verify new code doesn't add new failures |
| Implementation too large for one session | Save `_workspace/`, flag incomplete items for next session |
| Deploy failure mid-pipeline | Report the failure with error details, suggest next action (rollback, fix, retry) |

## Test Scenarios

### Normal Flow: Adding streaming support for a new field
1. User describes the new field and its expected format in both Anthropic and OpenAI
2. Phase 1: translation-specialist maps the field, streaming-specialist evaluates delta events
3. Phase 2: translation-specialist + streaming-specialist implement request/stream/response translation
4. Phase 3: code-reviewer reviews for correctness and test coverage
5. Phase 4: QA cross-verifies end-to-end, runs `bun test`
6. All tests pass → changes summarized

### Error Flow: Debugging a streaming hang
1. User reports streaming hangs with specific model/endpoint
2. Phase 1: streaming-specialist identifies missing `content_block_stop` in OpenAI→Anthropic direction
3. Phase 2: streaming-specialist fixes the block sequence; translation-specialist checks field mapping if needed
4. Phase 3: code-reviewer verifies the block lifecycle is correct
5. Phase 4: QA runs stream test with the exact payload shape, hang reproduced → verified fixed
6. If QA fails → loop back to Phase 2

### Deployment Flow: Deploy with new model or target
1. User asks to deploy (to CF Workers, Vercel, or binary)
2. routing-specialist handles model/routing changes; deployment-manager handles the deploy
3. deployment-manager runs `bun test`, deploys to the target, verifies
4. Status reported with deploy URL and model availability

### Code Review Flow: Review routing change
1. User asks to review the current routing changes
2. code-reviewer reads the diff, checks model override chain, error handling, auth flow
3. Review report generated with severity-classified findings
4. Findings presented to user for action

### Investigate Flow: Diagnose streaming hang
1. User reports streaming hangs with no specific request for a fix
2. Phase 1 only: streaming-specialist inspects the stream logic, writes diagnosis
3. Findings presented with severity and recommended fix
4. User decides whether to proceed to Fix/Feature flow

### Performance Audit Flow: Audit translator latency
1. User asks for a performance review
2. code-reviewer + qa-inspector + routing-specialist run in parallel
3. Findings ranked by hot path frequency × latency impact × fix cost
4. User picks which to apply; approved findings feed into Fix/Feature Phase 2

### Add New Model Flow: Register a new Zen free model
1. User says "add `ring-2.6-1t-free` to Zen"
2. routing-specialist verifies upstream support, writes routing spec
3. README.md model table updated
4. deployment-manager deploys, verifies model availability
5. Summary reported to user with the deploy URL and the new model path

## Description Follow-up Keywords

- "fix streaming hang", "debug streaming", "stream not working"
- "add model", "new model", "update model list"
- "fix translation", "wrong field", "field mapping bug"
- "deploy", "deployment", "update config", "change upstream", "Cloudflare", "LaunchAgent", "Vercel"
- "build", "binary", "standalone"
- "review", "code review", "review changes", "audit"
- "add test", "fix test", "test failing"
- "fix the response", "results are wrong"
- "rerun the fix", "re-execute the translation update"
- "deploy again", "redeploy"
- "rollback", "revert"
- Recurring expressions: "same bug with {other-model}", "still get {wrong behavior}"
