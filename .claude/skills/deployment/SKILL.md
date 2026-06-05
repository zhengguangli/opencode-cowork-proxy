---
name: deployment
description: "Full deployment and infrastructure management for the OpenCode Cowork Proxy — Cloudflare Workers deploy (wrangler), standalone Bun binary build (macOS), LaunchAgent lifecycle, CI/CD pipeline management (GitHub Actions), model list updates, dependency management, and deployment troubleshooting. MUST use for: deploy requests, build failures, CI/CD issues, model updates, config changes (wrangler.toml/package.json/tsconfig.json), LaunchAgent setup. Deployment-related changes should always check this skill before executing."
---

# OpenCode Cowork Proxy — Deployment & Infrastructure Guide

Complete reference for building, deploying, configuring, and maintaining the proxy across all deployment targets.

## Deployment Targets

| Target | Method | Use Case |
|--------|--------|----------|
| Cloudflare Workers | `bun run deploy` (wrangler) | Production — always-on, global edge network |
| Vercel | `bunx vercel deploy --prod` | Production — alternative to CF Workers, different egress IP pool |
| Standalone Bun binary | `bun run build:binary` + LaunchAgent | macOS local — for dev, offline, or behind firewall |
| Docker / other | Not yet supported | Future — Bun binary can run in any container |

---

## 1. Cloudflare Workers Deploy

### Prerequisites
- Cloudflare API token with Workers permissions (set as `CLOUDFLARE_API_TOKEN` env var, or configured via `wrangler login`)
- Project cloned and `bun install` run

### Deploy Steps

```bash
# Step 1: Run tests (MUST pass before deploy)
bun test

# Step 2: Dry run to verify config
bun run deploy -- --dry-run

# Step 3: Deploy
bun run deploy
```

### Configuration (wrangler.toml)

```toml
name = "opencode-cowork-proxy"
main = "src/index.ts"
compatibility_date = "2026-06-01"
```

Key fields:
- `name` — Worker name in Cloudflare dashboard
- `main` — Entry point (always `src/index.ts`)
- `compatibility_date` — CF Workers runtime version. Update when using newer API features. See [Compatibility Dates](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)

**No `compatibility_flags` or `routes` currently configured.** The proxy handles its own routing via Hono.

### Verify Deploy

```bash
curl https://<your-worker>.<your-subdomain>.workers.dev/
# Should return the proxy info JSON with endpoint listing
```

---

## 2. Standalone Bun Binary (macOS)

### Build

```bash
bun run build:binary
```

This produces a single Mach-O binary with no runtime dependencies (`bun build --compile --outfile opencode-cowork-proxy server.ts`).

### Install

```bash
cp opencode-cowork-proxy /usr/local/bin/opencode-cowork-proxy
```

### LaunchAgent Plist

Location: `~/Library/LaunchAgents/ai.opencode.proxy.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.opencode.proxy</string>
    <key>Program</key>
    <string>/usr/local/bin/opencode-cowork-proxy</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT</key>
        <string>18787</string>
        <key>VERSION</key>
        <string>2.1.0</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/usr/local/var/log/opencode-cowork-proxy.log</string>
    <key>StandardErrorPath</key>
    <string>/usr/local/var/log/opencode-cowork-proxy-error.log</string>
</dict>
</plist>
```

### Manage LaunchAgent

```bash
# Load (start + enable auto-start)
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.opencode.proxy.plist

# Unload (stop + disable auto-start)
launchctl bootout gui/$(id -u)/ai.opencode.proxy

# Check status
launchctl print gui/$(id -u)/ai.opencode.proxy

# View logs
tail -f /usr/local/var/log/opencode-cowork-proxy.log
tail -f /usr/local/var/log/opencode-cowork-proxy-error.log  # errors only
```

### Full Restart Cycle (after rebuild)

```bash
bun run build:binary
cp opencode-cowork-proxy /usr/local/bin/opencode-cowork-proxy
rm opencode-cowork-proxy
launchctl bootout gui/$(id -u)/ai.opencode.proxy
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.opencode.proxy.plist
tail -f /usr/local/var/log/opencode-cowork-proxy.log
```

---

## 3. Vercel Deploy

### Setup

```bash
# Install Vercel CLI (globally)
npm install -g vercel

# Link project (one-time)
vercel link --project opencode-cowork-proxy --scope zhengguangli-s-projects
```

### Entry Point

`api/[[...route]].ts` exports `app.fetch` directly (no `hono/vercel` adapter needed — it can cause builds to hang).

### Deploy

```bash
bunx vercel deploy --prod
```

Production URL: `https://opencode-cowork-proxy.vercel.app`

### Why Vercel

Cloudflare Workers use shared egress IPs that can trigger upstream (OpenCode) rate limiting (429). Vercel uses different IP pools, bypassing this issue. Useful when local proxy works but CF Workers consistently returns 429.

---

## 4. CI/CD Pipeline

The project uses GitHub Actions for automated deploy on push to `main`.

### Workflow File

`.github/workflows/release.yml`

```
Triggers:
  - push → main:     full pipeline (test → deploy → release)
  - PR → main:       test only (no deploy)
  - push → dev:      nothing

Steps:
  1. Check out repo (with full git history for version detection)
  2. Set up Bun (oven-sh/setup-bun@v1)
  3. bun install --frozen-lockfile
  4. bun test (blocking — pipeline halts if tests fail)
  5. (push only) wrangler deploy (via cloudflare/wrangler-action@v3)
  6. (push only) bunx vercel deploy --prod
  7. (push only) gh release create (tagged release-N)
```

### Required Secrets

| Secret | Source | Used By |
|--------|--------|---------|
| `CF_API_TOKEN` | Cloudflare dashboard → API Tokens | wrangler-action for Worker deploy |
| `VERCEL_TOKEN` | Vercel dashboard → Settings → Tokens | Vercel deploy |

### CI Steps

Keep the pipeline linear. Test failures block deploy. Deploy steps are conditional (`if: github.event_name == 'push'`) — they only run on merge to main, not on PRs.

---

## 5. Model List Management

### Models to Track

**Go models** (from opencode.ai/models):
- `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-v4-flash-free`
- `minimax-m3`, `minimax-m2.7`, `minimax-m2.5`
- `qwen3.7-max`, `qwen3.6-plus`
- (plus new models added upstream)

**Zen free models** (from opencode.ai/docs/zen):
- `big-pickle`, `deepseek-v4-flash-free`, `mimo-v2.5-free`, `nemotron-3-super-free`
- OpenAI-compatible chat models

### Update Procedure

1. Check upstream model list at [opencode.ai/models](https://opencode.ai/models)
2. Update model tables in `README.md` (Go models + Zen free models sections)
3. Update `src/models.ts` if the file exists and contains a model list
4. If new model requires special handling (vision support, thinking mapping, rate limits), notify translation-specialist and routing-specialist
5. Commit and test

---

## 6. Configuration Reference

### package.json Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `wrangler dev` | Local dev with CF Workers runtime |
| `build:binary` | `bun build --compile --outfile opencode-cowork-proxy server.ts` | Build standalone binary (macOS) |
| `deploy` | `wrangler deploy` | Publish to Cloudflare |
| `test` | `vitest run` | Run all tests |
| `test:watch` | `vitest` | Watch mode for TDD |

All commands run via `bun run <script>` (not npm). Example: `bun test`, `bun run dev`, `bun run deploy`.

### Dependencies

| Package | Type | Version | Purpose |
|---------|------|---------|---------|
| `hono` | runtime | ^4.12.17 | HTTP framework |
| `@cloudflare/workers-types` | dev | ^4.20260504.1 | TypeScript types for CF Workers |
| `vitest` | dev | ^3.2.4 | Test runner |
| `wrangler` | dev | ^4.87.0 | CF Workers CLI |

### Environment Variables

| Variable | Used By | Purpose |
|----------|---------|---------|
| `PORT` | server.ts | Port for standalone binary (default: 8787) |
| `CLOUDFLARE_API_TOKEN` | wrangler (env) | API token for `wrangler deploy` |
| `VERCEL_TOKEN` | Vercel CLI | API token for `vercel deploy --prod` |

### tsconfig.json Key Settings

| Setting | Value | Reason |
|---------|-------|--------|
| `strict` | true | Full type safety |
| `target` | ES2022 | Modern JS features |
| `module` | ESNext | ESM support |
| `types` | `@cloudflare/workers-types` | CF Workers runtime types |

---

## 7. Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `bun run deploy` fails with auth error | Missing or invalid Cloudflare API token | Run `wrangler login` or set `CLOUDFLARE_API_TOKEN` |
| Bun build fails with TS error | TypeScript error in source | Fix TS error, then rebuild |
| LaunchAgent won't load | Binary not found or plist syntax error | Check `/usr/local/bin/opencode-cowork-proxy` exists; run `plutil ~/Library/LaunchAgents/ai.opencode.proxy.plist` |
| LaunchAgent loaded but proxy not responding | Port conflict or binary crash | Check log at `/usr/local/var/log/opencode-cowork-proxy.log`; check port with `lsof -i :18787` |
| CI pipeline fails at bun test | Test regression | Check CI logs for failing test; can be reproduced locally with `bun test` |
| CI pipeline fails at deploy step | CF API token expired or invalid | Regenerate token in Cloudflare dashboard, update GitHub secret |
| Worker deployed but returns 404 | Wrong route or path | Verify the URL path starts with expected prefix (`/go`, `/zen`, or none) |
| Vercel deploy fails | VERCEL_TOKEN missing or expired | Generate new token in Vercel dashboard, update GitHub secret |

---

## 8. Rollback Procedures

### Cloudflare Rollback

```bash
# Rollback to previous version
npx wrangler rollback

# Or via dashboard: Workers & Pages → your worker → Deployments → rollback
```

### Standalone Binary Rollback

```bash
# Reinstall previous version
cp /usr/local/bin/opencode-cowork-proxy /usr/local/bin/opencode-cowork-proxy.bak  # backup first
# Rebuild from git history:
git checkout <previous-tag>
bun run build:binary
cp opencode-cowork-proxy /usr/local/bin/opencode-cowork-proxy
rm opencode-cowork-proxy
# Then reload LaunchAgent
launchctl bootout gui/$(id -u)/ai.opencode.proxy
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.opencode.proxy.plist
```

### CI/CD Rollback

- Revert the commit on `main` that triggered the bad deploy
- Push the revert — CI will re-deploy the previous version
- Alternatively: `npx wrangler rollback` for immediate revert (faster than CI)
