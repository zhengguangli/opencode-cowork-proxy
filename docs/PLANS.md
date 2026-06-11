# Development Plans: opencode-cowork-proxy

> Recent changes, current focus, and future roadmap for the API translation gateway.

## Recent (Completed)

- ~~**Vercel deployment addition** -- Removed, Vercel no longer used.~~
- **Pass-through fast path** -- Implemented fast-path optimization that avoids JSON parsing when no model override or image markers are present. Uses `rawBodyMayHaveImages()` for lightweight string scan before full parse. (Commit: 8402f9a)
- **Gzip response compression** -- Added automatic gzip compression for responses over 1KB when client supports it. (Commit: 8402f9a)
- **Health check polish** -- Added uptime formatting, upstream URL display, endpoint documentation to `GET /` response. (Commit: 8402f9a)
- **Architecture refactor** -- Split monolithic `index.ts` into 4 focused modules: routing, handlers, config, request utilities. Added architecture boundary tests. (Commit: 009a732)
- **Vision-aware model override** -- Detect images in request body and automatically switch to a vision-capable model. (Commit: b83b61b)
- **DeepSeek thinking injection** -- Auto-inject `thinking: {type: "enabled"}` for DeepSeek reasoning models in Responses API path. (Commit: b34199d)
- **Multi-deployment targets** -- Cloudflare Workers (primary), Bun standalone binary (local), Vercel serverless (fallback).
- **All 8 knowledge base docs filled** -- DESIGN.md, SECURITY.md, QUALITY_SCORE.md, RELIABILITY.md, FRONTEND.md, PLANS.md, PRODUCT_SENSE.md, and ARCHITECTURE.md all populated with project-specific content. FIXES.md recreated. 7 TODO placeholder docs filled. (Commits: aa654ae, 60b9526)
- **brew services deployment doc** -- Updated local deployment docs to use `brew services` for the Bun standalone binary. (Commit: 5552dc7)

## Current (In Progress)

- **Documentation completeness** -- Ensuring all knowledge base documents contain specific, project-derived content (this task).
- **Type assertion cleanup** -- Replacing bare `as` casts in test files with `as` pattern compatible with TypeScript 6.x strict mode. 27 test file type assertions cleaned in commit aa654ae.
- **Test quality** -- Maintaining 19 test files (~4000 lines) covering architecture boundaries, translation logic, error handling, streaming, auth, routing, vision, and backpressure.

## Future (Planned)

### Short-Term

- **Enhanced monitoring** -- Add structured logging, metrics endpoint, or tracing header propagation for production observability.
- **Upstream health checking** -- Add optional upstream health validation to the `GET /` endpoint (without wasting upstream request quota).
- **CI/CD pipeline** -- Add GitHub Actions for automated test runs, architecture boundary checks, and deployment.

### Medium-Term

- **Additional upstream provider support** -- Add routing and translation for alternate non-opencode.ai providers (e.g., provider-specific auth header formats, custom model catalogs).
- **Rate limit awareness** -- Add client-side rate-limit header consumption to throttle requests before reaching upstream caps.
- **Request validation hardening** -- Add schema validation for request bodies (via Zod or similar) instead of relying solely on runtime type guards.

### Long-Term

- **Full Responses API bidirectional translation** -- Add Chat Completions -> Responses API request translation for complete bidirectional support.
- **Plugin architecture** -- Abstract translation implementations behind interfaces so new format pairs can be added without modifying core routing.
- **Load testing benchmarks** -- Establish baseline throughput/latency numbers for each deployment target.
