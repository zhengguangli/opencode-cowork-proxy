---
name: model-registry
description: "Source of truth for which AI models exist on which upstream (opencode.ai/zen/go vs opencode.ai/zen), what capabilities each has (vision, thinking, function calling, code execution), pricing tier (free vs paid), and known quirks. MUST consult before: adding a new model, changing vision model forcing logic, debugging 'model not found' errors, recommending a model to a user, deciding which upstream hosts a new feature, or any time a hardcoded model name appears in the proxy. Updated whenever routing-specialist or deployment-manager changes the model catalog. Knowledge here is the result of live upstream /v1/models calls — never trust stale memory."
---

# Model Registry

The proxy routes requests to two distinct upstreams with different model catalogs and pricing tiers. Hardcoding a model name is a bug — different upstreams have different models, and the right model depends on what the user is trying to do.

## The Two Upstreams

| Upstream | URL | Pricing | URL prefix |
|----------|-----|---------|------------|
| **Go** (paid) | `https://opencode.ai/zen/go` | All paid | `/go` |
| **Zen** (free + paid mix) | `https://opencode.ai/zen` | Mix of free and paid | `/zen` |

Default upstream (no prefix) is **Go**.

## Live Catalogs (Last verified: 2026-06-07)

### Go upstream (`/go`) — all paid
```
claude-opus-4-8, claude-opus-4-7, claude-opus-4-6, claude-opus-4-5, claude-opus-4-1
claude-sonnet-4-6, claude-sonnet-4-5, claude-sonnet-4, claude-haiku-4-5
gemini-3.5-flash, gemini-3.1-pro, gemini-3-flash
gpt-5.5, gpt-5.5-pro, gpt-5.4, gpt-5.4-pro, gpt-5.4-mini, gpt-5.4-nano
gpt-5.3-codex-spark, gpt-5.3-codex, gpt-5.2, gpt-5.2-codex
gpt-5.1, gpt-5.1-codex-max, gpt-5.1-codex, gpt-5.1-codex-mini
gpt-5, gpt-5-codex, gpt-5-nano
grok-build-0.1
deepseek-v4-pro, deepseek-v4-flash
glm-5.1, glm-5
minimax-m3, minimax-m2.7, minimax-m2.5
kimi-k2.6, kimi-k2.5
qwen3.7-max, qwen3.7-plus, qwen3.6-plus, qwen3.5-plus
mimo-v2-pro, mimo-v2-omni, mimo-v2.5-pro, mimo-v2.5
hy3-preview
```

### Zen upstream (`/zen`) — free + paid mix
**Free tier:**
```
big-pickle
deepseek-v4-flash-free
mimo-v2.5-free
qwen3.6-plus-free              ← FREE PROMOTION ENDED 2026-06-07 (no longer free)
minimax-m3-free
nemotron-3-ultra-free
nemotron-3-super-free
```

**Paid tier (also on /zen):**
```
claude-opus-4-8, claude-opus-4-7, claude-opus-4-6, claude-opus-4-5, claude-opus-4-1
claude-sonnet-4-6, claude-sonnet-4-5, claude-sonnet-4, claude-haiku-4-5
gemini-3.5-flash, gemini-3.1-pro, gemini-3-flash
gpt-5.5, gpt-5.5-pro, gpt-5.4, gpt-5.4-pro, gpt-5.4-mini, gpt-5.4-nano
gpt-5.3-codex-spark, gpt-5.3-codex, gpt-5.2, gpt-5.2-codex
gpt-5.1, gpt-5.1-codex-max, gpt-5.1-codex, gpt-5.1-codex-mini
gpt-5, gpt-5-codex, gpt-5-nano
grok-build-0.1
glm-5.1, glm-5
minimax-m2.7, minimax-m2.5
kimi-k2.6, kimi-k2.5
qwen3.6-plus, qwen3.5-plus
```

## Vision-Capable Models (for Image Forcing)

When the proxy detects an image in the request, the model selection is **vision-aware**:

1. If the requested model (from body or URL path override) is already vision-capable on the routed upstream → **keep it** (no override)
2. Otherwise → fall back to the default vision model for the upstream

This means users who explicitly request `claude-sonnet-4-6` (vision-capable) keep their model even with images, while users requesting `deepseek-v4-flash` (not vision-capable) get force-routed to a vision model.

### Default Vision Models (Fallback)

| Upstream | Default vision model | Why |
|----------|---------------------|-----|
| `/go` (opencode.ai/zen/go) | `qwen3.6-plus` | Multilingual + vision + good free-tier alternative was qwen3.6-plus-free but that promotion ended |
| `/zen` (opencode.ai/zen) | `mimo-v2.5-free` | Multimodal (vision) + actually free on /zen. **NOT** qwen3.6-plus-free (promotion ended — upstream returns 402/ModelError) |

### Vision-Capable Model Sets (mirror `VISION_CAPABLE_GO` / `VISION_CAPABLE_ZEN` in `src/index.ts`)

**`VISION_CAPABLE_GO`** (models that accept image inputs on `/go`):
- Anthropic Claude: `claude-opus-4-{1,5,6,7,8}`, `claude-sonnet-4-{,5,6}`, `claude-haiku-4-5`
- Google Gemini: `gemini-3{,1,5}-flash`, `gemini-3.1-pro`
- OpenAI GPT-5.x (paid variants): `gpt-5`, `gpt-5-codex`, `gpt-5.1`, `gpt-5.1-codex`, `gpt-5.1-codex-{min,max}`, `gpt-5.2`, `gpt-5.2-codex`, `gpt-5.3-codex`, `gpt-5.3-codex-spark`, `gpt-5.4`, `gpt-5.4-{mini,pro}`, `gpt-5.5`, `gpt-5.5-pro`
  - **Excluded:** `gpt-5.4-nano`, all `gpt-5.x-nano` (text-only)
- Qwen: `qwen3.5-plus`, `qwen3.6-plus`, `qwen3.7-{max,plus}`
- Xiaomi mimo: `mimo-v2-pro`, `mimo-v2-omni`, `mimo-v2.5`, `mimo-v2.5-pro`
- Other: `hy3-preview`

**`VISION_CAPABLE_ZEN`** (paid models same as `/go` + free vision-capable):
- All paid models from `VISION_CAPABLE_GO` **EXCEPT** `qwen3.7-{max,plus}` (not on /zen), `mimo-v2-pro`, `mimo-v2-omni`, `mimo-v2.5-pro`, `hy3-preview` (not on /zen)
- **Plus free models:** `mimo-v2.5-free`
  - **NOT vision-capable free models:** `big-pickle`, `deepseek-v4-flash-free`, `minimax-m2.5-free`, `minimax-m3-free`, `nemotron-3-{super,ultra}-free`

### Selection Logic (`src/index.ts:getVisionModel`)

```typescript
function getVisionModel(upstream: string, requestedModel?: string | null): string {
  if (requestedModel) {
    if (upstream.includes("/zen/go") && VISION_CAPABLE_GO.has(requestedModel)) return requestedModel;
    if (upstream.includes("/zen") && VISION_CAPABLE_ZEN.has(requestedModel)) return requestedModel;
  }
  if (upstream.includes("/zen/go")) return GO_VISION_MODEL;   // "qwen3.6-plus"
  if (upstream.includes("/zen")) return ZEN_VISION_MODEL;      // "mimo-v2.5-free"
  return GO_VISION_MODEL;
}
```

**Safe default:** Unknown models are treated as NOT vision-capable → force-override. This means when adding a new model:
1. If it's vision-capable → add to `VISION_CAPABLE_GO` (and `VISION_CAPABLE_ZEN` if it's on /zen)
2. If it's NOT vision-capable → no change needed (it will be auto-redirected when images are present)
3. Update this registry table in the same commit

### ⚠️ Past Bug: Hardcoded Vision Model (fixed 2026-06-07)

A previous version of the proxy hardcoded `VISION_MODEL = "qwen3.6-plus"` regardless of route. This caused `/zen` image requests to fail with `ModelError: Free promotion has ended` (after 2026-06-07) and `404 model not found` (before 2026-06-07, when `qwen3.6-plus` was thought to be `/go`-only — but it's actually on `/zen` too).

**Rule:** Never use a single hardcoded vision model. Always select based on `route.upstream` AND check if the requested model is already vision-capable.
  return "qwen3.6-plus";
}
```

## Model Quirks (Update This When Discovered)

| Model | Quirk | Source of truth |
|-------|-------|-----------------|
| **Minimax (m2.5, m2.7, m3, m3-free)** | Embeds reasoning inside inline `<think>...</think>` tags in `content` rather than using `reasoning_content` field. Translators must strip these tags. | `src/translate/response/chat-completions-to-responses.ts`, `src/translate/stream/chat-completions-to-responses.ts` (state machine with `inThinkTag` + `thinkTagBuffer`) |
| **DeepSeek (v3, v4-flash, v4-pro, v4-flash-free)** | Accepts `thinking: {type: "enabled"}` parameter; `type:"reasoning"` items in Responses API input must merge with next assistant message | `src/translate/request/responses-to-chat-completions.ts` |
| **qwen3.6-plus-free** | Free promotion ended 2026-06-07. Do not route to it; use `mimo-v2.5-free` for /zen vision instead. | This registry |
| **Qwen3 vision models** | Force image-bearing requests to `qwen3.6-plus` (Go) or `mimo-v2.5-free` (Zen) | `src/index.ts` `getVisionModel()` |

## How to Update This Registry

1. `curl -s https://opencode.ai/zen/v1/models -H "Authorization: Bearer dummy" | jq '.data[].id'`
2. `curl -s https://opencode.ai/zen/go/v1/models -H "Authorization: Bearer dummy" | jq '.data[].id'`
3. Update the catalog tables above
4. Note the date in "Last verified"
5. If pricing tier changed for any model, add a quirk entry

## When Adding a New Model (Workflow)

1. **routing-specialist** verifies the model exists in the upstream `/v1/models` list
2. **routing-specialist** updates `src/index.ts` constants if the model needs special handling (e.g., vision forcing)
3. **deployment-manager** updates README.md model tables
4. **deployment-manager** deploys
5. Update this skill's catalog tables
6. **If the new model is vision-capable** → add to `VISION_CAPABLE_GO` (and `VISION_CAPABLE_ZEN` if it's on /zen) in the same commit
7. If the new model is the new default vision model for an upstream → update `GO_VISION_MODEL` / `ZEN_VISION_MODEL`

## When a Model Breaks (e.g., free promotion ends)

1. Verify the breakage with a real upstream call (not from memory)
2. If the model was the forced vision model: update `getVisionModel()` to a working alternative
3. If the model was in the general catalog: leave it in the list (some users may still pay for it) but mark it as a known issue in the quirks table
4. Add a regression test in `test/index.test.ts` for the routing decision
