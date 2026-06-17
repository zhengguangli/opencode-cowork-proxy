---
name: deployment
description: >
  Deployment for opencode-cowork-proxy. Cloudflare Workers via wrangler and
  standalone macOS binary via bun build --compile.
  Triggers on: "deploy", "部署", "wrangler", "publish", "release", "binary",
  "build", "Cloudflare Workers".
capabilities:
  - deployment
  - configuration
  - ops
---

# Deployment Skill

## Deployment Targets

This project supports **two deployment targets**:

| Target | Command | When to use |
|--------|---------|-------------|
| Cloudflare Workers | `bunx wrangler deploy` | Production edge deployment |
| Standalone macOS binary | `bun run build:binary` | Local/personal use, or when CF Workers rate limits are a concern |

## Cloudflare Workers Deployment

### Configuration

`wrangler.toml` at project root:

```toml
name = "opencode-cowork-proxy"
main = "src/index.ts"
compatibility_date = "2026-06-01"
```

### Deploy

```bash
bunx wrangler deploy
```

### Local Dev (CF Workers)

```bash
bun run dev
# Starts local server via scripts/build-entry.ts on port 8787
```

The dev server uses Bun's built-in HTTP server — no `wrangler dev` needed.

### Environment Variables

CF Workers secrets are set via:

```bash
echo "<api-key>" | wrangler secret put ANTHROPIC_AUTH_TOKEN
```

## Standalone Binary

### Build

```bash
bun run build:binary
# Produces: dist/opencode-cowork-proxy (standalone executable)
```

Build flags: `--compile --bytecode --outfile ./dist/opencode-cowork-proxy`

The binary runs as an HTTP server on port 8787 by default (no CF Workers runtime dependency).

### Binary Environment

Set environment variables for the binary:

```bash
export ANTHROPIC_BASE_URL="http://localhost:18787/zen"
export ANTHROPIC_AUTH_TOKEN="sk-..."
```

## Version Management

Package version is in `package.json` (`version` field). Update before deploying:

```bash
# Current version: 2.1.5
bun run typecheck     # verify before deploy
bun test              # verify before deploy
bunx wrangler deploy  # deploy to CF Workers
```

## Deploy Checklist

- [ ] `bun test` — all 521 tests pass
- [ ] `bun run typecheck` — no TypeScript errors
- [ ] `bun run build` — worker bundle builds successfully
- [ ] Version bumped in `package.json` (if needed)
- [ ] CHANGELOG.md updated
- [ ] `bunx wrangler deploy` — deploy to production

## See Also
- Wrangler config → `wrangler.toml`
- Build entry → `scripts/build-entry.ts`
- Operations docs → @ref:docs/OPERATIONS.md
- Version info → `src/version.ts`
