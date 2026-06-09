---
name: deployment
description: "Step-by-step deployment instructions for the OpenCode Cowork Proxy. Three targets: Cloudflare Workers (wrangler), Vercel (bunx vercel deploy), standalone Bun binary on macOS (LaunchAgent). MUST use for: any deploy request (CF/Vercel/binary/all), build failure debugging, CI/CD pipeline issues, model update deploy, config change in wrangler.toml/package.json/tsconfig.json, LaunchAgent setup/reload, port change, env var change, new GitHub Actions secret, version bump. Includes troubleshooting: Vercel build hang from hono/vercel adapter, CF Workers 429 rate limiting, binary arch mismatch, LaunchAgent won't start, lockfile out of sync."
---

# Deployment

The proxy has three deployment targets, three entry points, and three sets of constraints.

## Entry Points

| Entry | Target | Runtime | Notes |
|-------|--------|---------|-------|
| `src/index.ts` | CF Workers, Vercel | Hono (Worker runtime) | Exports `app` as default |
| `server.ts` | Bun standalone, dev | Bun built-in HTTP | Reads `PORT` env var (default 18787) |
| `api/[[...route]].ts` | Vercel only | Hono (serverless) | Re-exports `app.fetch` directly — NO `hono/vercel` adapter |

`src/version.ts` imports `package.json` for version. Never add runtime version detection (git rev-parse, env var fallbacks).

---

## Cloudflare Workers

```bash
bun test && bun run deploy
curl -s https://opencode-cowork-proxy.<subdomain>.workers.dev/
```

Config: `wrangler.toml`. Secrets: `wrangler secret put NAME` or GitHub Actions `CF_API_TOKEN`.

**429 from upstream:** Cloudflare's shared egress IPs get rate-limited. Deploy to Vercel as fallback.

---

## Vercel

```bash
bun test && bunx vercel deploy --prod
curl -s https://opencode-cowork-proxy.vercel.app/
```

Entry: `api/[[...route]].ts` must export `app.fetch` directly.

**DO NOT add `hono/vercel` adapter** — causes builds to hang indefinitely. **`build` script auto-detection:** Binary build is named `build:binary` (not `build`) to prevent Vercel from trying to compile a macOS binary during deployment.

---

## Standalone Binary (macOS)

```bash
bun test && bun run build:binary
cp ./opencode-cowork-proxy /usr/local/bin/opencode-cowork-proxy
chmod +x /usr/local/bin/opencode-cowork-proxy
```

LaunchAgent plist: `~/Library/LaunchAgents/ai.opencode.proxy.plist`

```bash
# Reload (bootout → bootstrap, never try to "restart" directly)
launchctl bootout gui/$(id -u)/ai.opencode.proxy 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.opencode.proxy.plist

# Check status
launchctl print gui/$(id -u)/ai.opencode.proxy

# View logs
tail -f /usr/local/var/log/opencode-cowork-proxy.log
```

**Wrong arch:** Use `--target=bun-darwin-arm64` (Apple Silicon) or `--target=bun-darwin-x64` (Intel).

---

## CI/CD (GitHub Actions)

File: `.github/workflows/release.yml`

Pipeline: checkout → `oven-sh/setup-bun@v1` → `bun install --frozen-lockfile` → `bun test` → optional CF/Vercel deploy.

Required secrets: `CF_API_TOKEN`, `VERCEL_TOKEN`.

---

## Version Bumping

1. Edit `package.json` → `"version": "X.Y.Z"`
2. Optionally update LaunchAgent plist `VERSION` env var
3. Commit and push

---

## Pre-Deploy Checklist

- [ ] `bun test` passes
- [ ] `bun install --frozen-lockfile` succeeds
- [ ] Version bumped in `package.json`
- [ ] No uncommitted changes in `src/`, `test/`, `wrangler.toml`, `package.json`
- [ ] README.md updated if adding/removing/changing a model
- [ ] LaunchAgent plist updated if port or env var changed
- [ ] If adding a model, updated `model-registry` skill catalog
