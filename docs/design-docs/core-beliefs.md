# Core Beliefs: opencode-cowork-proxy

> Foundational design philosophy that guides all technical decisions.

## 1. Format Translation Is a Pure Mapping Problem

**The proxy should be nothing more than a function -- input format A, output format B.**

This belief drives the core architecture: all 9 translation modules are pure functions with no I/O. They accept `Record<string, unknown>` and return `Record<string, unknown>`. Stream translators are pure `ReadableStream -> ReadableStream` transforms.

Consequence: Translation is testable without mocking. Each translator has a well-defined contract that can be validated with unit tests alone.

## 2. Statelessness Is a Security Feature

**No data persistence means no data to steal.**

The proxy does not write to databases, files, or in-memory stores. The only cache is the Cloudflare Cache API for model lists (URL-based key, auth-independent, 300s TTL). This eliminates the largest class of security vulnerabilities (data breaches from persistence) and simplifies deployment (no state to recover, no migrations).

## 3. The Client Should Never Know a Translation Happened

**From the client's perspective, the proxy is the target API.**

Clients send API requests in their native format (Anthropic Messages to `/v1/messages`, OpenAI Chat Completions to `/v1/chat/completions`). The proxy translates transparently. Response formats, error structures, and streaming events are mapped to whatever the client expects.

The sole exception is HTTP status codes and error relay -- upstream errors are forwarded with original status and body to preserve debuggability.

## 4. Configuration Is Constants, Not Runtime Config

**There is no runtime configuration mechanism. All settings are compile-time constants in `src/config.ts`.**

Upstream URLs, timeout values, retry counts, body size limits, vision model sets -- all are hardcoded with no env-var overrides (except `DEBUG`). This eliminates:
- Configuration drift between environments.
- Configuration validation code.
- Secret management complexity.

Deployment-specific configuration (which upstream, which port) is handled by the deployment mechanism (wrangler.toml for CF Workers, process.env for Bun, vercel.json for Vercel).

## 5. Single Runtime Dependency Is a Feature

**Hono is the only runtime dependency.**

A smaller dependency surface means:
- Fewer CVEs to track.
- Faster cold starts.
- Smaller binary size.
- Easier to audit.

Every new dependency must justify its inclusion against these benefits.

## 6. Model Override Is a Routing Concern, Not a Translation Concern

**Model selection happens before translation, in the handler layer, not inside translators.**

The model override chain (URL -> vision -> thinking injection) runs in the handler before calling translation functions. Translators operate on the already-modified body. This keeps translators simpler (they don't know about routing) and avoids duplicate model selection logic across translation modules.

## 7. Fail Open for Upstream, Fail Closed for Auth

**Authentication errors must never proxy through to upstream.** All API requests are authenticated before any processing begins. But the proxy does not validate upstream health or response quality -- it trusts the upstream.

## 8. Progressive Complexity in Request Handling

**Most requests should take the simplest possible code path.**

The handler design tier:
1. **Fast path**: No model override + no image markers in raw body -> send raw body verbatim (0 parsing).
2. **Slow path**: Parse body, apply overrides, re-serialize.
3. **Translation path**: Parse, translate format, send, translate response back.

This prevents unnecessary JSON parsing from becoming a performance bottleneck.
