# Testing: opencode-cowork-proxy

> Test strategy, categories, patterns, and coverage targets.

## 1. Test Suite Overview

**Framework:** Bun's built-in test runner (`bun test`)
**Location:** `test/`
**Run:** `bun test` or `bun run test`
**Typecheck:** `bun run typecheck` (runs `tsc --noEmit`)
**Watch mode:** `bun run test:watch`

### Current Inventory

28 test files covering ≈46 source files.

## 2. Test Categories

### 2.1 Translation Tests (8 files)
Verify format conversion between Anthropic and OpenAI APIs.

| File | Coverage | Pattern |
|------|----------|---------|
| `test/openai-to-anthropic-request.test.ts` | Request translation OpenAI → Anthropic | Pure function, snapshot-style |
| `test/anthropic-to-openai-request.test.ts` | Request translation Anthropic → OpenAI | Pure function, snapshot-style |
| `test/responses-request.test.ts` | Responses API request translation | Pure function |
| `test/responses-response.test.ts` | Responses API response translation | Pure function |
| `test/responses-stream.test.ts` | Streaming response translation | Stream assertion |
| `test/response.test.ts` | General response translation | Pure function |
| `test/stream.test.ts` | Stream translation utilities | Stream assertion |
| `test/think-tag-stripper.test.ts` | Think tag stripping | Pure function |

### 2.2 Handler & Integration Tests (5 files)
Test HTTP handlers with mocked upstreams.

| File | Coverage | Pattern |
|------|----------|---------|
| `test/routing.test.ts` | URL routing | Request/response integration |
| `test/responses-api.test.ts` | Responses API handler | Integration with mocks |
| `test/error-handling.test.ts` | Error scenarios | Error path coverage |
| `test/websocket.test.ts` | WebSocket handling | WebSocket integration |
| `test/model-override.test.ts` | Model override logic | Handler integration |

### 2.3 Architecture Tests (1 file)
Enforce layer isolation invariants.

| File | Coverage | Pattern |
|------|----------|---------|
| `test/architecture.test.ts` | Layer import rules | Static import analysis |

### 2.4 Utility Tests (8 files)
Test non-translation utilities and services.

| File | Coverage | Pattern |
|------|----------|---------|
| `test/auth.test.ts` | Authentication | Pure function |
| `test/auth-enhanced.test.ts` | Extended auth scenarios | Pure function |
| `test/cache.test.ts` | Response cache | Stateful unit test |
| `test/response-cache.test.ts` | Cache behavior | Stateful unit test |
| `test/rate-limit.test.ts` | Rate limit tracking | Stateful unit test |
| `test/backpressure.test.ts` | Backpressure handling | Async unit test |
| `test/vision.test.ts` | Vision/image handling | Pure function |
| `test/compress.test.ts` | Compression | Unit test |

### 2.5 Validation & Plugin Tests (4 files)
Test schema validation and plugin system.

| File | Coverage | Pattern |
|------|----------|---------|
| `test/validate.test.ts` | Request validation | Schema-based |
| `test/providers.test.ts` | Provider routing | Unit test |
| `test/plugin.test.ts` | Plugin system | Integration test |
| `test/metrics.test.ts` | Metrics endpoint | Integration test |

### 2.6 Audit Tests (2 files)

| File | Coverage | Pattern |
|------|----------|---------|
| `test/audit.test.ts` | Audit event logging | Unit test |
| `test/utils.test.ts` | General utilities | Unit test |

## 3. Testing Patterns

### Pure Function Tests (preferred)
```typescript
// Translation functions are pure — no mocks needed
const result = translateFunction(input);
expect(result).toEqual(expected);
```

### Stream Assertion Tests
```typescript
// Stream translators use readbleStream assertion helpers
const output = streamTranslator(inputStream);
await expect(output).toStreamMatch(expectedChunks);
```

### Integration Tests
```typescript
// HTTP handlers use Hono's test helper
const res = await app.request('/v1/messages', { method: 'POST', ... });
expect(res.status).toBe(200);
```

## 4. Coverage Targets

| Category | Current | Target |
|----------|---------|--------|
| Translation pure functions | ~90% | ≥95% |
| Handlers | ~75% | ≥85% |
| Utilities | ~85% | ≥90% |
| Architecture invariants | 1 file (full coverage) | Maintain |
| Plugin system | ~60% | ≥80% |

## 5. Running Tests

```bash
# All tests
bun test

# Single file
bun test test/translate.test.ts

# Watch mode
bun test --watch

# Type checking
bun run typecheck

# CI (both)
bun test && bun run typecheck
```

## 6. Writing Tests

### Guidelines
1. **Prefer pure function tests** over integration tests — faster, more reliable
2. **Test error paths** — translation errors, auth failures, invalid input
3. **Use realistic payloads** — copy real API request/response bodies
4. **Don't test framework behavior** — test your logic, not Hono's HTTP handling
5. **Name test files after the source file** — `src/translate/request/foo.ts` → `test/foo.test.ts`
