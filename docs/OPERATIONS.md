# Operations: opencode-cowork-proxy

> Deployment, monitoring, scaling, and incident response runbook.

## 1. Deployment Targets

| Target | Method | Config | Notes |
|--------|--------|--------|-------|
| Cloudflare Workers | `bun run deploy` | `wrangler.toml` | Primary production target |
| Bun standalone | `bun run build:binary` | CLI flags | macOS/local deployment |
| Vercel | Vercel dashboard | `vercel.json` (implied) | Secondary serverless target |

## 2. Cloudflare Workers Deployment

### Prerequisites
- Wrangler CLI (`bunx wrangler`)
- Cloudflare account with Workers subscription
- `wrangler.toml` configured with `account_id`

### Deploy
```bash
bun run deploy
```

### Environment Variables
Set via `wrangler secret put <KEY>` or Cloudflare dashboard:

| Variable | Required | Description |
|----------|----------|-------------|
| `X_API_KEY` | Yes | API key for client authentication |
| `UPSTREAM_API_KEY` | Yes | API key for upstream provider |
| `OPENAI_API_KEY` | If using OpenAI upstream | Alternative upstream key |

### Rollback
```bash
bunx wrangler rollback
```
Rolls back to the previous deployed version. For specific version:
```bash
bunx wrangler deploy --version <id>
```

## 3. Local Deployment (Bun Standalone)

### Build
```bash
bun install
bun run build:binary
```

### Run
```bash
./dist/opencode-cowork-proxy
```

### macOS LaunchAgent
See `README.md` for LaunchAgent plist configuration.
Use `brew services restart opencode-cowork-proxy` to restart.

## 4. Monitoring

### Health Check
```
GET /
```
Returns upstream URLs and service status. Does **not** validate upstream reachability.

### Metrics
```
GET /metrics
```
Prometheus-format metrics. See `docs/RELIABILITY.md` section 4 for metric types.

### Audit Log
```
POST /audit/log
```
Six audit event types logged. See `src/audit.ts` and `docs/SECURITY.md`.

## 5. Scaling

### Cloudflare Workers
- Auto-scales with Cloudflare's global network
- No manual scaling configuration needed
- Monitor CPU time and subrequest limits via Cloudflare dashboard

### Bottlenecks
- **Upstream rate limits**: The proxy is stateless and depends on upstream availability
- **Memory**: Workers have 128MB memory limit; streaming responses reduce per-request memory
- **CPU time**: 30s CPU time limit per request on Workers (free plan) or 60s (paid)

## 6. Incident Response

### Incident Types

| Type | Symptom | Immediate Action |
|------|---------|-----------------|
| Upstream down | 5xx from upstream | `GET /` health check; switch URL prefix `/go` ↔ `/zen` |
| API key invalid | 401 responses | Check `X_API_KEY` and `UPSTREAM_API_KEY` secrets |
| Rate limited | 429 responses | Check upstream status; add client-side retry with backoff |
| Deployment failure | Wrangler error | Check `wrangler.toml`; run `bunx wrangler whoami` to verify auth |

### Recovery Steps

**Upstream Down:**
1. Run `GET /` health check
2. If `/go` upstream fails, switch client requests to `/zen` prefix
3. If both fail, check https://status.opencode.ai
4. As fallback, use `X-Upstream-Url` header to route to alternative compatible endpoint

**Memory/CPU Limit:**
1. Reduce concurrent long-running streaming requests
2. Check if response caching is active (`src/response-cache.ts`)
3. Consider deploying to paid Cloudflare plan for higher limits

## 7. Backup & Recovery

- **No persistent data**: The proxy is stateless. No database backups needed.
- **Configuration**: Store `wrangler.toml`, secrets, and environment config in version control (secrets excluded).
- **Binary artifacts**: `dist/` is gitignored; rebuild from source.
