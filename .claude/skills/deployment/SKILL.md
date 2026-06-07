---
name: deployment
description: "Step-by-step deployment instructions for the OpenCode Cowork Proxy. Three targets: Cloudflare Workers (wrangler), Vercel (bunx vercel deploy), standalone Bun binary on macOS (LaunchAgent). MUST use for: any deploy request, build failure, CI/CD issue, model update, config change in wrangler.toml/package.json/tsconfig.json, LaunchAgent setup/reload, port change, env var change, new GitHub Actions secret. Includes troubleshooting for common failures (Vercel build hang from hono/vercel adapter, CF Workers 429, binary arch mismatch, LaunchAgent won't start)."
---

# Deployment

The proxy has three deployment targets, three entry points, and three sets of constraints. This skill has the step-by-step for each.

## The Three Entry Points (Know These First)

| Entry | Target | Runtime | Notes |
|-------|--------|---------|-------|
| `src/index.ts` | CF Workers, Vercel | Hono (Worker runtime) | Exports `app` as default. **Same app** used by all three. |
| `server.ts` | Bun standalone, dev | Bun built-in HTTP | Reads `PORT` env var |
| `api/[[...route]].ts` | Vercel only | Hono (serverless) | Re-exports `app.fetch` directly. **Do NOT import `hono/vercel` adapter** — it can cause builds to hang. |

`src/version.ts` imports `package.json` for the version string. This is intentional — do not add runtime version detection that varies by target.

---

## Cloudflare Workers

**When to use:** Primary production target. Best for high-traffic + low-latency.

**Pre-flight:**
```bash
bun test                          # must pass
cat wrangler.toml                 # verify config (main, vars, compatibility_date)
```

**Deploy:**
```bash
bun run deploy                    # = wrangler deploy
```

**Verify:**
```bash
curl -s https://opencode-cowork-proxy.<your-subdomain>.workers.dev/ | head -c 200
# Should return JSON with name, version, upstream, routes
```

**Config file:** `wrangler.toml`
- `name` — Worker name
- `main` — entry point (`src/index.ts` after build)
- `compatibility_date` — Workers runtime version
- `vars` — env vars (non-secret)
- Use `wrangler secret put NAME` for secrets (or GitHub Actions `CF_API_TOKEN`)

**Common issues:**
- **429 from upstream:** Cloudflare's shared egress IPs sometimes get rate-limited. **Deploy to Vercel as a fallback.** Same code, different IP.
- **`wrangler` not found:** `bunx wrangler` or install globally: `npm i -g wrangler`
- **Auth failure:** `wrangler login` or set `CLOUDFLARE_API_TOKEN` env var

---

## Vercel

**When to use:** Fallback when Cloudflare Workers hits upstream rate limits. Same code, different egress IP.

**Pre-flight:**
```bash
bun test                          # must pass
cat api/[[...route]].ts           # verify it exports app.fetch (not hono/vercel adapter!)
```

**Deploy:**
```bash
bunx vercel deploy --prod
```

**Verify:**
```bash
curl -s https://opencode-cowork-proxy.vercel.app/ | head -c 200
```

**Entry point file:** `api/[[...route]].ts` — should look like:
```typescript
export { default } from '../src/index';
// or:
import app from '../src/index';
export default app;
```

**⚠️ DO NOT add `hono/vercel` adapter.** It's known to cause Vercel builds to hang. The Hono app works in Vercel's serverless runtime without the adapter.

**Common issues:**
- **Build hangs forever:** You imported `hono/vercel` somewhere. Remove it.
- **`build` script auto-detected:** Vercel runs any script named `build` in `package.json` during deploy. The macOS binary build script is named `build:binary` (not `build`) for this reason.
- **Auth failure:** `vercel login` or set `VERCEL_TOKEN` env var

---

## Standalone Binary (macOS)

**When to use:** Local development, private deployment, when you don't want a serverless platform.

**Pre-flight:**
```bash
bun test                          # must pass
```

**Build:**
```bash
bun run build:binary              # = bun build --compile --outfile opencode-cowork-proxy server.ts
```

**Install:**
```bash
cp ./opencode-cowork-proxy /usr/local/bin/opencode-cowork-proxy
chmod +x /usr/local/bin/opencode-cowork-proxy
```

**Manage with LaunchAgent:**

The LaunchAgent plist lives at `~/Library/LaunchAgents/ai.opencode.proxy.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList.dtd">
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
        <string>2.1.1</string>
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

**Common commands:**
```bash
# Reload after binary update
launchctl bootout gui/$(id -u)/ai.opencode.proxy 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.opencode.proxy.plist

# Check status
launchctl print gui/$(id -u)/ai.opencode.proxy

# View logs
tail -f /usr/local/var/log/opencode-cowork-proxy.log
tail -f /usr/local/var/log/opencode-cowork-proxy-error.log

# Stop
launchctl bootout gui/$(id -u)/ai.opencode.proxy
```

**Common issues:**
- **Wrong architecture:** On Apple Silicon, use `--target=bun-darwin-arm64`. On Intel Macs, use `--target=bun-darwin-x64`. Default is x64.
- **LaunchAgent won't start:** Check `launchctl print gui/$(id -u)/ai.opencode.proxy` for the specific error. Common causes: bad plist XML, missing program, port already in use.
- **Old binary still running after update:** `lsof -i:18787` to find the process, then `kill -9 <pid>`.
- **`Could not find service` on bootout:** The service isn't currently loaded. Safe to ignore.

---

## CI/CD (GitHub Actions)

**File:** `.github/workflows/release.yml`

**Pipeline:**
1. Checkout
2. `oven-sh/setup-bun@v1` — install Bun
3. `bun install --frozen-lockfile` — verify lockfile in sync
4. `bun test` — must pass
5. (Optional) Cloudflare deploy — requires `CF_API_TOKEN` secret
6. (Optional) Vercel deploy — requires `VERCEL_TOKEN` secret

**Required GitHub secrets:**
- `CF_API_TOKEN` — Cloudflare API token with Workers deploy permission
- `VERCEL_TOKEN` — Vercel deploy token

**Required environment variables for `bun install --frozen-lockfile`:**
- None special, but the lockfile must be committed.

**Common issues:**
- **CI fails on `bun install --frozen-lockfile`:** Someone added a dep without committing `bun.lock`. Run `bun install` locally, commit.
- **CI fails on `bun test`:** Tests pass locally but not in CI. Usually a timing issue or env-var dependency. Look for `process.env` in test code.

---

## Development Server

For local dev with verbose logging:
```bash
DEBUG=true bun run server.ts      # starts on port 8787
```

`DEBUG=true` enables `[RESPONSES]` prefixed log output in the Responses API path. Useful for debugging Responses API translation.

---

## Version Bumping

Version source is `package.json`. The proxy imports it in `src/version.ts`:
```typescript
import pkg from '../package.json';
export const VERSION = pkg.version;
```

To bump:
1. Edit `package.json` → `"version": "2.1.2"`
2. Update `~/Library/LaunchAgents/ai.opencode.proxy.plist` → `<key>VERSION</key><string>2.1.2</string>` (optional, for log identification)
3. Update CLAUDE.md → "Notable recent changes" section
4. Commit and push

The CI/CD pipeline tags releases based on the version in `package.json`.

---

## Configuration Authority (One-Page Reference)

| What | Where |
|------|-------|
| CF Workers config | `wrangler.toml` |
| CF secrets | `CF_API_TOKEN` env / GitHub Actions secret |
| Vercel config | `vercel.json` (if present) + `api/[[...route]].ts` |
| Vercel secrets | `VERCEL_TOKEN` env / GitHub Actions secret |
| LaunchAgent config | `~/Library/LaunchAgents/ai.opencode.proxy.plist` |
| Package metadata | `package.json` (version, scripts, deps) |
| TS config | `tsconfig.json` |
| CI/CD | `.github/workflows/release.yml` |
| Bun lockfile | `bun.lock` (commit after every `bun add`) |

---

## Pre-Deploy Checklist (Run This Every Time)

- [ ] `bun test` passes
- [ ] `bun install --frozen-lockfile` succeeds (lockfile in sync)
- [ ] Version bumped in `package.json` (for releases)
- [ ] No uncommitted changes in `src/`, `test/`, `wrangler.toml`, `package.json`
- [ ] README.md updated if adding/removing/changing a model
- [ ] LaunchAgent plist updated if port or env var changed (binary target only)
- [ ] If adding a model, updated `model-registry` skill
