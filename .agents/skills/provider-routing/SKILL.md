---
name: provider-routing
description: "Provider registry, prefix routing, vision model routing, upstream format detection. Triggers on: \"provider\", \"upstream\", \"路由\", \"vision model\", \"模型目录\". Do NOT trigger for general routing discussion."
capabilities:
  - routing
  - configuration
  - code-gen
---

# Provider Routing

## Architecture

```
Request URL
    ↓
routeConfig() (src/routing.ts)
    ↓
ProviderRegistry.resolveByPrefix() (src/providers.ts)
    ↓
UpstreamProvider → baseUrl + buildAuthHeaders()
    ↓
getUpstream() / upstreamFormat() (src/routing.ts)
    ↓
Fetch to upstream
```

## ProviderRegistry

**File:** `src/providers.ts`

Three providers registered at startup via `registerBuiltinProviders()`:

| Name | Label | Base URL | Default | Auth |
|------|-------|----------|---------|------|
| go | OpenCode Go | `GO_UPSTREAM` (`src/config.ts`) | Yes | `Authorization: Bearer <key>` |
| zen | OpenCode Zen | `ZEN_UPSTREAM` (`src/config.ts`) | No | `Authorization: Bearer <key>` |
| anthropic | Anthropic-Compatible | Dynamic (`X-Upstream-Url`) | No | `X-Api-Key: <key>` + `Anthropic-Version: 2023-06-01` |

Global singleton: `providerRegistry` — call `ensureProvidersRegistered()` once at startup.

## UpstreamProvider Interface

```typescript
interface UpstreamProvider {
  name: string;
  label: string;
  baseUrl: string;
  isDefault: boolean;
  isVisionCapable(model: string): boolean;
  getVisionModel(requestedModel?: string | null): string;
  buildAuthHeaders(apiKey: string): Record<string, string>;
  apiVersion?: string;
}
```

- `isVisionCapable(model)` — checks if model is in the provider's vision set
- `getVisionModel(model)` — returns model if vision-capable, otherwise provider fallback
- `buildAuthHeaders(key)` — returns provider-specific auth header map

## Prefix Routing

**File:** `src/routing.ts` — `routeConfig(request)`

| URL Pattern | Provider | Model Override |
|-------------|----------|----------------|
| `/go/v1/messages` | go | none |
| `/go/claude-sonnet-4/v1/messages` | go | `claude-sonnet-4` |
| `/zen/v1/messages` | zen | none |
| `/zen/mimo-v2.5-free/v1/messages` | zen | `mimo-v2.5-free` |
| `/v1/messages` | go (default) | none |
| `/claude-sonnet-4/v1/messages` | go (default) | `claude-sonnet-4` |

**File:** `src/providers.ts` — `resolveByPrefix(path)`

1. Try exact prefix match `/go/...` → go, `/zen/...` → zen (longest-first sort)
2. Skip `anthropic` provider (no path prefix)
3. Fall back to default provider

Model name override extraction (`extractModelSegment` in `src/routing.ts`):
- First path segment treated as model if followed by `v\d+` API version segment
- Reserved non-model paths: `ws`, `health`, `audit`, `metrics`
- Standalone segments with `-` or matching `/^(gpt|deepseek|qwen|mimo|gemini|claude)/` treated as models

## Vision Model Sets

**File:** `src/config.ts`

| Set | Fallback Model | Models |
|-----|---------------|--------|
| `VISION_CAPABLE_GO` | `qwen3.6-plus` | claude-opus-4-*, claude-sonnet-4-*, claude-haiku-4-5, gemini-*, gpt-5.*, qwen3.7-*, qwen3.6-plus, qwen3.5-plus, mimo-v2-*, mimo-v2.5, hy3-preview |
| `VISION_CAPABLE_ZEN` | `mimo-v2.5-free` | Subset of GO — excludes: qwen3.7-max, qwen3.7-plus, mimo-v2-pro, mimo-v2-omni, mimo-v2.5-pro, mimo-v2.5, hy3-preview |

These are hard-coded `Set<string>`. Must be manually verified against upstream catalogs:

```bash
curl -s https://opencode.ai/zen/go/v1/models
curl -s https://opencode.ai/zen/v1/models
```

## Upstream Format & URL Override

**File:** `src/routing.ts`

```typescript
upstreamFormat(request: Request): "openai" | "anthropic"
```

Reads `X-Upstream-Format` header (default: `openai`). Determines whether translation is needed.

```typescript
getUpstream(request: Request, routeUpstream: string): string
```

Reads `X-Upstream-Url` header. If present and valid URL → overrides `routeUpstream`. Invalid URLs are silently ignored.

## Adding a New Provider

1. **`src/config.ts`** — Add constants:
   - `NEW_UPSTREAM` base URL
   - `NEW_VISION_MODEL` fallback
   - `VISION_CAPABLE_NEW` Set

2. **`src/providers.ts`** — Add provider object implementing `UpstreamProvider`:
   ```typescript
   const newProvider: UpstreamProvider = {
     name: 'new',
     label: 'New Provider',
     baseUrl: NEW_UPSTREAM,
     isDefault: false,
     isVisionCapable(model: string): boolean {
       return VISION_CAPABLE_NEW.has(model);
     },
     getVisionModel(requestedModel?: string | null): string {
       if (requestedModel && VISION_CAPABLE_NEW.has(requestedModel)) return requestedModel;
       return NEW_VISION_MODEL;
     },
     buildAuthHeaders(apiKey: string): Record<string, string> {
       return { 'Authorization': `Bearer ${apiKey}` };
     },
   };
   ```

3. **`src/providers.ts`** — Register in `registerBuiltinProviders()`:
   ```typescript
   providerRegistry.register(newProvider);
   ```

4. **`src/routing.ts`** — No changes needed. `resolveByPrefix()` auto-discovers providers by name.

5. **`src/config.ts`** — Add `NEW_UPSTREAM` to `UPSTREAM_FORWARD_HEADERS` if needed.

## Edge Cases

- `/ws/` prefix → 426 Upgrade Required (checked before routing in `src/index.ts`)
- `/health`, `/audit`, `/metrics` — reserved, not treated as models
- `anthropic` provider has empty `baseUrl` — must use `X-Upstream-Url` header
- Model override in URL takes priority over vision model fallback
- If `X-Upstream-Url` fails `new URL()` validation, the header is silently ignored