# Archived: 2026-06-04 Responses API Bug-Fix Run

## Origin
Artifacts from the orchestrator run that produced commit `f010dfd fix: 15 routing + 8 translation bugs from comprehensive code review`.

## Contents
- `01_translation_diagnosis.md` — translation-specialist output: 23 bugs across all 9 translator files
- `01_streaming_diagnosis.md` — streaming-specialist output: streaming event sequencing bugs
- `01_routing_diagnosis.md` — routing-specialist output: routing/auth/cache bugs
- `02_translation_changes.md` — implementation summary for translation layer fixes
- `02_streaming_changes.md` — implementation summary for streaming layer fixes
- `02_routing_changes.md` — implementation summary for routing layer fixes
- `03_review_report.md` — code-reviewer output: severity-classified findings
- `04_qa_report.md` — qa-inspector output: 138/138 tests pass, but flagged **23 bugs with no regression tests** (open follow-ups)

## Key Findings Worth Preserving

### CRITICAL bugs found and fixed
1. **`tool_choice` format mismatch** (openai-to-anthropic.ts:166) — OpenAI `{type:"function",function:{name}}` was passed verbatim to Anthropic which expects `{type:"tool",name}`.
2. **Tool calls dropped in Responses API assistant** (responses-to-chat-completions.ts:74-77) — non-DeepSeek path ignored `tool_call` content blocks; only DeepSeek path called `extractToolCalls`.

### Open Follow-up Items (not addressed in this run)
Per `04_qa_report.md`, regression tests are missing for all 23 fixed bugs. Highest-priority gaps:
- Bug 1: `tool_choice` mapping (CRITICAL) — no test
- Bug 2: Responses API tool call extraction (CRITICAL) — no test
- Bug 3: URL-based image source handling (HIGH) — no test
- Bug 4: Base64 `input_image.source` (MEDIUM) — no test
- Bug 5: First tool call chunk arguments (MEDIUM) — no test
- Bug 6: Cache tokens in Anthropic→OpenAI response (MEDIUM) — no test

These are valid follow-up work for a future translation-specialist + qa-inspector session.

## Why Archived
The orchestrator preserves `_workspace/` for audit trail, but six uncurated files from a prior run polluted the directory. This archive is timestamped so future runs start clean.
