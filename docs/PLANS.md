# Development Plans: opencode-cowork-proxy

> Recent changes, current focus, and future roadmap for the API translation gateway.

## Recent (Completed)

- ~~**CI/CD pipeline** -- GitHub Actions with test + audit dual jobs, architecture boundary enforcement, file size checks.~~
- ~~**Prometheus metrics** -- `GET /metrics` endpoint exposing 6 metric types (requests, latency, upstream, streams, uptime).~~
- ~~**Upstream health probe** -- `GET /health/upstream?probe=true` lightweight connectivity check with latency reporting.~~
- ~~**Zod v4 request body validation** -- 3 schemas (Anthropic, OpenAI, Responses API) with detailed error reporting.~~
- ~~**Rate-limit awareness** -- `src/rate-limit.ts` auto-tracks upstream RateLimit-* headers, warns on low quota, recommends delay.~~
- ~~**SSE streaming gzip compression** -- Automatic CompressionStream-based compression for all streaming paths.~~
- ~~**Plugin translator architecture** -- `TranslatorRegistry` + `FormatPair` interfaces for extensible translation registration.~~
- ~~**Upstream provider abstraction** -- `ProviderRegistry` with go/zen/anthropic providers, `resolveByPrefix()` routing.~~
- ~~**Dependency audit** -- `scripts/audit-deps.mjs` with lockfile validation, npm audit, version pinning.~~
- ~~**Load testing** -- `scripts/load-test.mjs` with concurrency, duration, p50/p90/p99, status distribution.~~
- ~~**OpenAPI spec** -- `scripts/generate-openapi.mjs` → `docs/openapi.json` covering all 10 endpoints.~~
- ~~**In-memory response cache** -- LRU cache (50 entries, TTL-based) for deterministic endpoints.~~
- ~~**Enhanced API key validation** -- base64url format check, key type identification (sk-/pk-/sk-ant- prefixes).~~
- ~~**Structured audit logging** -- `src/audit.ts` with 6 event types, `GET /audit/log` ring buffer endpoint.~~
- ~~**WebSocket upgrade handler** -- `GET /ws/*` returns 426 with SSE fallback instructions.~~
- ~~**Unified logging system** -- ALL output (access, audit, debug, app) through `src/logger.ts` in consistent JSON format.~~
- ~~**Startup profiling** -- Registry init timing logged, audit event emitted on startup.~~
- ~~**512 tests, 0 failures, 0 TypeScript errors** -- Maintained throughout all optimization phases.~~

## Current (In Progress)

- **Production deployment monitoring** -- Tuning metrics collection, establishing latency baselines, configuring log aggregation.
- **Security hardening** -- Ongoing review of auth flows, key handling, and upstream trust boundaries.

## Future (Planned)

### Short-Term

- **Responses API bidirectional support** -- Add Chat Completions → Responses API upstream request translation.
- **Full upstream failover** -- Auto-detect upstream degradation and fail over between /go and /zen.
- **Request tracing header propagation** -- Support `X-Request-Id` / `X-Trace-Id` for end-to-end observability.

### Medium-Term

- **Additional upstream providers** -- Support non-opencode.ai providers via the `ProviderRegistry` plug-in interface.
- **WebSocket native support** -- Full bidirectional streaming over WebSocket (requires Durable Objects or external proxy).

### Long-Term

- **Plugin marketplace** -- External translator/provider plugins discoverable at runtime.
- **Load testing benchmarks** -- Establish baseline throughput/latency numbers for each deployment target.
- **Schema-driven OpenAPI spec** -- Auto-derive request/response schemas from Zod definitions.
