---
name: testing
description: >
  Project testing patterns for opencode-cowork-proxy. 521 tests across 28 files.
  Bun test runner, Hono test client, architecture boundary tests, stream tests.
  Triggers on: "test", "测试", "verify", "assertion", "mock", "stream test",
  "run tests", "add test", "bun test".
capabilities:
  - testing
  - verification
  - code-gen
---

# Testing Skill

## Test Runner

This project uses **Bun's built-in test runner** (`bun test`), which supports the Vitest-compatible `describe`/`it`/`expect`/`vi` API. Tests are run via:

```bash
bun test                    # all 521 tests
bun test test/routing.test.ts        # single file
bun test --watch            # watch mode
bun test --coverage         # coverage report
```

## Test File Organization

All tests live in `test/` at the project root. One file per source module or functional area:

| Test file | Tests what |
|-----------|------------|
| `test/architecture.test.ts` | Layer boundary rules (127 checks), import isolation |
| `test/routing.test.ts` | URL prefix routing, model override extraction |
| `test/validate.test.ts` | Zod v4 request schema validation |
| `test/auth.test.ts` / `auth-enhanced.test.ts` | API key extraction and validation |
| `test/stream.test.ts` | SSE stream translation (OpenAI↔Anthropic) |
| `test/compress.test.ts` | Gzip compression |
| `test/backpressure.test.ts` | Streaming backpressure |
| `test/vision.test.ts` | Vision model routing |
| `test/response-cache.test.ts` | LRU response cache |
| `test/anthropic-to-openai-request.test.ts` | Request format translation |
| `test/openai-to-anthropic-request.test.ts` | Reverse request translation |
| `test/response.test.ts` | Response format translation |
| `test/responses-api.test.ts` | Responses API format translation |
| `test/responses-request.test.ts` | Responses request translation |
| `test/responses-response.test.ts` | Responses response translation |
| `test/responses-stream.test.ts` | Responses stream translation |
| `test/plugin.test.ts` | Translator/Provider plugin registry |
| `test/rate-limit.test.ts` | Rate-limit header tracking |
| `test/audit.test.ts` | Audit event logging |
| `test/metrics.test.ts` | Prometheus metrics |
| `test/error-handling.test.ts` | Error response formats |
| `test/model-override.test.ts` | Model override header handling |
| `test/utils.test.ts` | Shared utility functions |
| `test/websocket.test.ts` | WebSocket upgrade handling |
| `test/cache.test.ts` | Request caching |
| `test/think-tag-stripper.test.ts` | DeepSeek think tag removal |

## Testing Patterns

### HTTP Handler Tests (most common pattern)

Use `new Request()` to simulate HTTP requests, then call the target function directly:

```typescript
import { routeConfig } from '../src/routing';

it('routes /v1/messages to default upstream', () => {
  const req = new Request('http://localhost/v1/messages');
  const r = routeConfig(req);
  expect(r.path).toBe('/v1/messages');
  expect(r.upstream).toBe(DEFAULT_UPSTREAM);
});
```

The Hono app (`src/index.ts`) is also importable directly for integration tests:

```typescript
import worker from '../src/index';
```

### Stream Translation Tests

Two standard helpers in `test/stream.test.ts`:

```typescript
/** Collect all chunks from a ReadableStream into a string */
async function collectStream(stream: ReadableStream): Promise<string>;

/** Create a ReadableStream from SSE text chunks */
function sseStream(...chunks: string[]): ReadableStream;
```

Test a stream translator by constructing SSE chunks, running through the translator, and asserting on the output:

```typescript
const openaiSSE = sseStream(
  'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
  'data: [DONE]\n\n',
);
const result = await collectStream(streamOpenAIToAnthropic(openaiSSE, 'test-model'));
expect(result).toContain('event: content_block_start');
```

### Architecture Boundary Tests

Static import analysis via `getImports()` — no runtime required. Tests check that:
- `src/translate/` modules don't import from `src/request.ts` or `src/index.ts`
- Layer direction rules are enforced

### Mocking

Use Vitest-style `vi` for mocks:

```typescript
import { vi } from 'vitest';

vi.mock('../src/providers', () => ({ resolveUpstream: () => 'http://mock' }));
```

## Common Test Tasks

| Task | Command |
|------|---------|
| Run all tests | `bun test` |
| Run single test file | `bun test test/routing.test.ts` |
| Run tests matching a pattern | `bun test --test-name-pattern "stream"` |
| Run architecture tests only | `bun test test/architecture.test.ts` |
| Watch mode (re-run on change) | `bun test --watch` |
| Type check | `bun run typecheck` |
| Add a new test file | Create `test/<module-name>.test.ts` following naming convention |

## Quality Gates

Before committing:
```bash
bun test              # all tests pass
bun run typecheck     # TypeScript: no errors
```

## See Also
- Architecture tests → `test/architecture.test.ts`
- Security tests → `test/auth.test.ts`, `test/auth-enhanced.test.ts`
- Stream test helpers → `test/stream.test.ts`
- Test patterns docs → @ref:docs/TESTING.md
