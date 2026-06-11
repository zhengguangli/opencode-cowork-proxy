# Product Sense: opencode-cowork-proxy

> Who uses it, what problem it solves, and core value proposition.

## Target Users

**Primary users are developers who use Claude Code with third-party API providers.**

Claude Code (Anthropic's CLI coding agent) communicates via Anthropic's Messages API format. Many alternative AI API providers (e.g., opencode.ai, other proxy services) only support OpenAI's Chat Completions format. This proxy bridges the gap.

Additional use cases:
- **Codex CLI users** who need OpenAI Responses API support through Chat Completions-only upstreams.
- **OpenAI SDK users** who want to access non-OpenAI providers without changing their client code.
- **Multi-provider users** who switch between Anthropic/SDK clients without reconfiguring format expectations.

## Problem Solved

### Format Incompatibility

The core problem is that different AI API providers speak different wire formats:

- Anthropic: `/v1/messages`, content blocks with `type:"text"`/`type:"image"`, SSE with `event: content_block_delta`.
- OpenAI: `/v1/chat/completions`, `role`-based messages, SSE with `data: {"choices": [...]}`.
- OpenAI Responses API (newer): `/v1/responses`, stateful input/output model, named-event SSE.

These formats are structurally incompatible. Translating between them requires:
- Mapping nested content blocks to flat message arrays and vice versa.
- Mapping streaming events between different SSE vocabularies.
- Mapping stop reasons (`stop_reason` <-> `finish_reason`).
- Mapping token usage statistics between different key names and aggregation patterns.

### Provider Lock-In

Without a translation layer, developers must choose one API format and stay locked into providers that support it. This proxy enables format-agnostic provider selection.

## Core Value Proposition

### 1. Minimal Overhead Translation

The proxy is designed to be as thin as possible:
- Single runtime dependency (Hono).
- No database, no queues, no background jobs.
- Sub-millisecond translation overhead for pure function calls.
- Fast-path bypasses JSON parsing for same-format requests.

### 2. Drop-In Compatibility

Clients configure the proxy URL and continue using their existing SDK:
- Claude Code: `export CLAUDE_PROXY_URL=https://proxy.example.com`
- OpenAI SDK: `new OpenAI({ baseURL: 'https://proxy.example.com' })`
- Codex CLI: Configured endpoint in CLI settings

No client code changes needed.

### 3. Three Deployment Options

- **Cloudflare Workers**: Global edge network, low latency, free tier available.
- **Bun standalone binary**: Local deployment, no network dependency, run via brew services.
- **Vercel serverless**: Alternative cloud hosting if Cloudflare Workers has issues (e.g., 429 rate limits).

### 4. Format-Aware Auth

The proxy validates API keys (32-char minimum) and forwards them with correct format-specific authentication headers (`X-Api-Key` for Anthropic, `Authorization: Bearer` for OpenAI). Clients don't need to understand upstream auth requirements.

## Non-Goals

- Not a model provider -- does not generate AI responses.
- Not a load balancer -- does not distribute across providers.
- Not a cache -- only caches model lists (and only on Cloudflare Workers).
- Not a UI -- API-only, no graphical interface.
