---
name: model-registry
description: "Source of truth for which AI models exist on which upstream (opencode.ai/zen/go vs opencode.ai/zen), what capabilities each has (vision, thinking, function calling), pricing tier (free vs paid), and known quirks. MUST consult before: adding a new model, changing vision model forcing logic, debugging 'model not found' errors, recommending a model, deciding which upstream hosts a feature, or any time a hardcoded model name appears in the proxy. Knowledge here is the result of live upstream /v1/models calls — never trust stale memory."
---

# Model Registry

The proxy routes requests to two upstreams with different model catalogs and pricing tiers. Hardcoding a model name is a bug.

## The Two Upstreams

| Upstream | URL | Pricing | Prefix |
|----------|-----|---------|--------|
| **Go** (paid) | `https://opencode.ai/zen/go` | All paid | `/go` |
| **Zen** (free + paid) | `https://opencode.ai/zen` | Mix | `/zen` |

Default (no prefix) is **Go**.

## Live Catalogs (Last verified: 2026-06-08)

### Go upstream (`/go`) — all paid (~18 models)

```
deepseek-v4-pro, deepseek-v4-flash
glm-5.1, glm-5
hy3-preview
kimi-k2.6, kimi-k2.5
mimo-v2-omni, mimo-v2-pro, mimo-v2.5, mimo-v2.5-pro
minimax-m3, minimax-m2.7, minimax-m2.5
qwen3.7-max, qwen3.7-plus, qwen3.6-plus, qwen3.5-plus
```

**NOT on Go:** all Claude, GPT, Gemini, Grok, deepseek-v4-flash-free, mimo-v2.5-free, minimax-m3-free, big-pickle, nemotron, qwen3.6-plus-free.

### Zen upstream (`/zen`) — free + paid (~46 models)

**Free tier:**
```
big-pickle
deepseek-v4-flash-free
mimo-v2.5-free              ← default vision fallback for /zen
qwen3.6-plus-free           ← FREE PROMOTION ENDED 2026-06-07
minimax-m3-free
nemotron-3-ultra-free
nemotron-3-super-free
```

**Paid tier (all on /zen):**
```
claude-opus-4-{1,5,6,7,8}, claude-sonnet-4-{,5,6}, claude-haiku-4-5
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

## Vision-Capable Models

When proxy detects an image: if requested model is already vision-capable on routed upstream → keep it. Otherwise → fall back to default vision model.

### Default Vision Models

| Upstream | Default | Why |
|----------|---------|-----|
| `/go` | `qwen3.6-plus` | Multilingual + vision |
| `/zen` | `mimo-v2.5-free` | Multimodal + actually free |

### Selection Logic (`src/index.ts:getVisionModel`)

```typescript
function getVisionModel(upstream: string, requestedModel?: string | null): string {
  if (requestedModel) {
    if (upstream.includes("/zen/go") && VISION_CAPABLE_GO.has(requestedModel)) return requestedModel;
    if (upstream.includes("/zen") && !upstream.includes("/zen/go") && VISION_CAPABLE_ZEN.has(requestedModel)) return requestedModel;
  }
  if (upstream.includes("/zen/go")) return GO_VISION_MODEL;
  if (upstream.includes("/zen")) return ZEN_VISION_MODEL;
  return GO_VISION_MODEL;
}
```

Safe default: unknown models → NOT vision-capable → force-override. When adding a vision-capable model, add to `VISION_CAPABLE_GO` and/or `VISION_CAPABLE_ZEN`.

## Model Quirks

| Model | Quirk |
|-------|-------|
| **Minimax (m2.5, m2.7, m3, m3-free)** | Embeds reasoning in inline `<think>` tags in `content` instead of `reasoning_content`. Strip with state machine. |
| **DeepSeek (v3, v4-*)** | Accepts `thinking: {type: "enabled"}`. `type:"reasoning"` items merge with next assistant message. |
| **qwen3.6-plus-free** | Free promotion ended 2026-06-07. Use `mimo-v2.5-free` for /zen vision. |

## How to Update

1. `curl -s https://opencode.ai/zen/v1/models -H "Authorization: Bearer $KEY" | jq '.data[].id'`
2. `curl -s https://opencode.ai/zen/go/v1/models -H "Authorization: Bearer $KEY" | jq '.data[].id'`
3. Update catalog tables above
4. Note date in "Last verified"
5. If pricing changed, add quirk entry

## When Adding a Model

1. Verify exists in upstream `/v1/models` (live curl, not memory)
2. Update `src/index.ts` if needs special handling (vision forcing)
3. Update README.md model tables
4. Deploy
5. Update this skill's catalog tables
6. If vision-capable → add to `VISION_CAPABLE_GO`/`VISION_CAPABLE_ZEN`
