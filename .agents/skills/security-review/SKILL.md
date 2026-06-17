---
name: security-review
description: >
  Security review for API gateway proxy. Auth bypass, header injection,
  upstream URL injection, think-tag stripping, rate limiting, body size gates.
  Triggers on: "security", "安全", "auth", "injection", "CVE", "vulnerability",
  "audit", "渗透", "threat model".
capabilities:
  - security
  - review
  - audit
---

# Security Review Skill

## Threat Model

This project is an **AI API translation gateway** — it sits between clients and upstream AI providers. Key attack surfaces:

| Attack Surface | Risk | Mitigation |
|----------------|------|------------|
| Auth bypass | Unauthenticated proxy access | `authenticateRequest()` in `src/request.ts` — all POST endpoints require 32+ char key |
| Upstream URL injection | SSRF via `X-Upstream-Url` header | Header maps to predefined upstreams; no user-supplied URLs in `getUpstream()` |
| Header smuggling | Malicious headers reaching upstream | Only specific headers forwarded (`X-Request-Id`, rate-limit headers) |
| Body size bomb | OOM/memory exhaustion | 10 MB gate via `checkBodySize()` before any processing |
| Think tag stripping | Content integrity bypass | Stripped only for DeepSeek models via `src/think-tag-stripper.ts` |
| Rate limit bypass | Free upstream usage | Upstream rate-limit headers tracked and forwarded |
| Model override injection | Unauthorized model access | Only prefix-based override via URL path (`/go/<model>/...`) |

## Review Checklist

### Auth (Critical)
- [ ] All POST endpoints pass through `authenticateRequest()` before processing
- [ ] Auth error returns correct format-aware body (Anthropic vs OpenAI format)
- [ ] Health check (`GET /`) and metrics (`GET /metrics`) are intentionally unauthenticated
- [ ] WebSocket upgrade path (`/ws/`) bypasses auth — verify WS auth handling

### Input Validation
- [ ] Body size < 10 MB (check `MAX_BODY_SIZE` in `src/config.ts`)
- [ ] JSON parsing wrapped in `safeJsonBody()` — no bare `request.json()`
- [ ] Zod v4 schemas reject unexpected fields (no pass-through)
- [ ] `type-guards.ts` used instead of bare `as` casts in translate layer

### Upstream Safety
- [ ] `X-Upstream-Url` header maps to predefined upstream set, not arbitrary URLs
- [ ] `X-Upstream-Format` header only accepts known format values
- [ ] Upstream fetch has timeout (no indefinite hang)
- [ ] Rate-limit headers are forwarded, not interpreted locally

### Output Safety
- [ ] Think tags stripped only for DeepSeek models, not by default
- [ ] Response cache (LRU, 50 entries, 60s TTL) doesn't leak auth headers
- [ ] Gzip compression applies after auth and content checks
- [ ] Error messages don't leak internal state (stack traces, paths)

### Observability & Audit
- [ ] All requests logged with unique `request_id` via `withRequestId()`
- [ ] Audit events recorded for auth failures, errors, and proxy startup
- [ ] Metrics endpoint (`GET /metrics`) exposes Prometheus counters
- [ ] Rate-limit headers tracked and available for monitoring

## Key Source Files for Security Review

| File | What to check |
|------|---------------|
| `src/auth.ts` | Key extraction, validation, minimum length |
| `src/request.ts` | `authenticateRequest()`, `checkBodySize()`, `safeJsonBody()` |
| `src/routing.ts` | Prefix parsing, model override extraction from URL |
| `src/config.ts` | Upstream URLs, vision model sets, constants |
| `src/think-tag-stripper.ts` | Think tag regex and model filter |
| `src/rate-limit.ts` | Upstream rate-limit header tracking |
| `src/audit.ts` | Audit event ring buffer (1000 events) |
| `src/validate.ts` | Zod v4 schemas per endpoint |
| `src/translate/type-guards.ts` | Runtime type narrowing safety |

## See Also
- Security docs → @ref:docs/SECURITY.md
- Auth implementation → `src/auth.ts`, `src/request.ts`
- Audit implementation → `src/audit.ts`
- Rate limiting → `src/rate-limit.ts`
- Think tag stripping → `src/think-tag-stripper.ts`
