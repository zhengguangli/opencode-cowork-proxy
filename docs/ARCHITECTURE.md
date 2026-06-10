# ARCHITECTURE

## 项目概述

OpenCode Cowork Proxy 是一个双向 API 翻译网关，位于 AI 客户端（Anthropic/Claude, OpenAI SDK）和上游 AI API 提供商（OpenCode Go / OpenCode Zen）之间。部署目标包括 Cloudflare Workers、Vercel 和 macOS 独立二进制。

**核心价值：** 客户端使用任何兼容的 SDK（Anthropic Messages API、OpenAI Chat Completions API、OpenAI Responses API）即可通过同一网关访问上游模型，无需修改客户端代码。

---

## 分层架构

```
┌─────────────────────────────────────────────────────────┐
│                   客户端 (Client)                        │
│   Anthropic SDK / OpenAI SDK / 任意 HTTP 客户端         │
└───────────────────────┬─────────────────────────────────┘
                        │ POST 请求
                        ▼
┌─────────────────────────────────────────────────────────┐
│                 路由层 (Routing Layer)                   │
│  src/routing.ts      URL 路径解析、上游选择、模型提取    │
│  src/index.ts        Hono 路由分发 + CORS               │
│  src/handlers/       5 个领域 handler                    │
└───────────────────────┬─────────────────────────────────┘
                        │
    ┌───────────────────┼──────────────────────┐
    ▼                   ▼                      ▼
┌──────────┐     ┌──────────┐     ┌──────────────────┐
│ Auth     │     │ Request  │     │ Cache            │
│ src/auth │◄────│ Sizing   │     │ src/cache.ts     │
│ .ts      │     │ & Fetch  │     │ 令牌提取/用量映射 │
│ 密钥提取 │     │ src/     │     └──────────────────┘
│ 与验证   │     │ request  │
└──────────┘     │ .ts      │
                  │ 重试/     │
                  │ 超时/压缩 │
                  └────┬─────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                  翻译层 (Translation Layer)              │
│                                                         │
│  ┌─ 请求方向 ─────────────────────────────────────────┐ │
│  │ formatAnthropicToOpenAI(request/)                  │ │
│  │ formatOpenAIToAnthropic(request/)                  │ │
│  │ formatResponsesToChatCompletions(request/)         │ │
│  │ + responses-helpers.ts (5 个提取的共享辅助函数)     │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌─ 响应方向 ─────────────────────────────────────────┐ │
│  │ toOpenAIResponse         (response/)               │ │
│  │ toAnthropicResponse      (response/)               │ │
│  │ formatChatCompletionsToResponses (response/)       │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌─ 流方向 ───────────────────────────────────────────┐ │
│  │ streamAnthropicToOpenAI     (stream/)              │ │
│  │ streamOpenAIToAnthropic     (stream/)              │ │
│  │ streamChatCompletionsToResponses (stream/)         │ │
│  │ + sse-encoder, sse-parser, finish-reason (共享)    │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌─ 共享工具 ─────────────────────────────────────────┐ │
│  │ type-guards.ts     — 运行时安全类型守卫              │ │
│  │ sse-encoder.ts     — SSE 帧编码器                   │ │
│  │ sse-parser.ts      — SSE 帧解析器                   │ │
│  │ finish-reason.ts   — finish_reason 映射             │ │
│  └────────────────────────────────────────────────────┘ │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│                  上游 (Upstream)                        │
│   OpenCode Go  (https://opencode.ai/zen/go)             │
│   OpenCode Zen (https://opencode.ai/zen)                │
│   或自定义 X-Upstream-Url                               │
└─────────────────────────────────────────────────────────┘
```

### 依赖方向（单向）

```
config → routing → index → handlers → request → translate
                                         ↓           ↑
                                      auth ──────────┘
```

- `config.ts` 位于最底层，被所有其他模块引用
- `type-guards.ts` 被 translate 和 cache 共用
- 横切关注点（auth、fetch、超时）通过 `request.ts` 的 `authenticateRequest()` 和 `safeUpstreamFetch()` 进入，非直接 import

---

## 三路径翻译

| 客户端格式 | 路径前缀 | 上游格式 | 翻译类型 |
|-----------|----------|----------|----------|
| Anthropic Messages API | `/v1/messages` | OpenAI Chat Completions | 请求：Anthropic→OpenAI，响应：OpenAI→Anthropic |
| OpenAI Chat Completions | `/v1/chat/completions` | 默认 OpenAI (若 x-upstream-format: anthropic 则 Anthropic) | 透传 或 请求：OpenAI→Anthropic |
| OpenAI Responses API | `/v1/responses` | OpenAI Chat Completions | 请求：Responses→Chat Completions，响应：Chat Completions→Responses |

### ADR-1: 为什么是翻译网关而非适配器库？

- 客户端（IDE 插件、CI 流水线）无法切换 SDK
- 多个团队/工具共享一个网关配置
- 上游端点可通过 `X-Upstream-Url` 头动态切换

### ADR-2: 为什么 Responses API 翻译为 Chat Completions 而非直接调用上游？

上游 Anthropic API 不支持 `/v1/responses` 端点。Chat Completions 作为通用翻译中介格式，三种路径共享一组上游处理逻辑，减少了维护三套独立上传路径的复杂度。

### ADR-3: 为什么 request.ts 合并多个关注点？

`index.ts` 的每个分支点都需要 auth、fetch、错误转发、gzip 压缩——如果拆分为独立文件，index.ts 需要 import 5-6 个模块反而增加复杂度。合并为一个文件后，`index.ts` 只需 5 个 handler + 1 个 request import。

---

## 路由机制

### URL 路径解析 (`src/routing.ts`)

```
请求路径                    → 上游                   → 路径
/go/v1/messages            → OpenCode Go            → /v1/messages
/go/deepseek-v4/v1/models  → OpenCode Go, 模型=deepseek-v4 → /v1/models
/zen/v1/chat/completions   → OpenCode Zen           → /v1/chat/completions
/v1/responses              → OpenCode Go (默认)     → /v1/responses
/                          → OpenCode Go (默认)     → / (健康检查)
```

路径分隔：
1. 检查 `/go` 前缀 → 若匹配，剩余路径 + 上游 = Go
2. 检查 `/zen` 前缀 → 若匹配，剩余路径 + 上游 = Zen
3. 无前缀 → 默认上游

模型覆盖提取：路径第一段若非版本号（`v1`），视为模型 ID，从路径中剥离。

### 模型覆盖链（按应用顺序）

1. **URL 路径段** — 如 `/go/deepseek-v4-pro/v1/messages` 覆盖 body 中的 model
2. **图像检测** — 若 body 包含图片且当前模型在上游不支持 vision → 强制切换默认 vision 模型
3. **Body `model` 字段** — 当 1 和 2 均未生效时使用

> ⚠️ 图像检测必须在 DeepSeek thinking 注入之前执行，防止对非 DeepSeek 模型注入 `{"type":"enabled"}` thinking 参数。

---

## 部署架构

| 目标 | 入口 | 运行时 |
|------|------|--------|
| Cloudflare Workers | `src/index.ts` (export `app`) | Hono (WinterCG) |
| Vercel | `api/[[...route]].ts` (export `app.fetch`) | Hono (serverless) |
| 本地开发 | `server.ts` (Bun built-in) | Bun |
| macOS 独立二进制 | `bun run build:binary` | Bun-compiled binary |

### 请求生命周期

```
Client → CORS 中间件 → bodySize 检查 → authenticateRequest
  → routeConfig() → upstream 选择
  → handler (根据 path + method 分发)
    → safeJsonBody() → 翻译请求
    → safeUpstreamFetch() (带重试)
    → translate response body
    → jsonResponse() (可选 gzip)
    → 返回 Response
```

### 流式请求生命周期

```
Client → (同上) → handler
  → safeJsonBody() → stream: true
  → safeUpstreamFetch() (读 body 流)
  → 创建 TransformStream
  → 流翻译器转换 SSE 事件
  → 转发到客户端
```

---

## 核心设计决策

### Parse, Don't Validate

JSON 反序列化后的数据统一使用 `asRecord()`, `asRecordArray()`, `asRecordOptional()` 类型守卫处理，而非裸 `as` 断言：

```typescript
// ❌ 不安全的裸断言
const details = usage.prompt_tokens_details as Record<string, unknown>;

// ✅ 运行时安全的类型守卫
const details = asRecordOptional(usage.prompt_tokens_details);
```

当前状态：业务代码中 `as Record<string, unknown>` 断言数量为 **0**。

### 纯函数翻译器

全部 9 个翻译器是纯函数——没有 `fetch`、没有副作用。这使得它们可以通过构造输入 payload 并断言输出形状来独立测试，无需模拟网络调用。

### 响应错误透传

上游返回非 2xx 时（`!res.ok`），`upstreamErrorResponse()` 透传状态码和 body，并转发以下头部：`Content-Type`、`Retry-After`、`RateLimit-Limit`、`RateLimit-Remaining`、`RateLimit-Reset`。

### 令牌用量映射

OpenAI 兼容上游的 `prompt_tokens` 已包含缓存令牌。`extractUncachedInputTokens()` 减去缓存令牌避免 Anthropic 格式的双重计数。详见 CLAUDE.md §Common Pitfalls #3。

---

## 项目文件结构

```
src/
├── index.ts              — Hono 路由入口 + CORS
├── routing.ts            — URL 路径解析、上游选择、模型提取
├── config.ts             — 全局常量（上游 URL、vision 模型集、超时）
├── request.ts            — 请求处理编排（auth、fetch、压缩、错误转发）
├── auth.ts               — API key 提取与验证（纯函数）
├── cache.ts              — 令牌提取与用量映射
├── vision.ts             — 图像检测与 vision 模型选择
├── think-tag-stripper.ts — <think> 标签剥离（流式 + 非流式）
├── backpressure.ts       — 流背压辅助
├── version.ts            — 版本号（从 package.json 导入）
├── handlers/             — 领域 handler（5 文件）
│   ├── index.ts          — barrel export
│   ├── shared.ts         — RouteInfo 接口
│   ├── messages.ts       — Anthropic→OpenAI handler
│   ├── chat-completions.ts — OpenAI→Anthropic handler
│   ├── responses.ts      — Responses API handler
│   ├── models.ts         — 模型列表 handler
│   └── health.ts         — 健康检查 handler
└── translate/            — 翻译层（9 个纯函数翻译器 + 共享工具）
    ├── index.ts          — barrel export
    ├── type-guards.ts    — 运行时类型守卫
    ├── request/          — 请求方向翻译（3 文件）
    │   ├── anthropic-to-openai.ts
    │   ├── openai-to-anthropic.ts
    │   ├── responses-to-chat-completions.ts
    │   └── responses-helpers.ts
    ├── response/         — 响应方向翻译（3 文件）
    │   ├── anthropic-to-openai.ts
    │   ├── openai-to-anthropic.ts
    │   └── chat-completions-to-responses.ts
    └── stream/           — 流翻译 + 共享 SSE 工具（5 文件）
        ├── anthropic-to-openai.ts
        ├── openai-to-anthropic.ts
        ├── chat-completions-to-responses.ts
        ├── sse-encoder.ts
        ├── sse-parser.ts
        └── finish-reason.ts
test/
├── index.test.ts         — 集成测试入口（10 行，仅保留集成测试）
├── auth.test.ts          — 认证测试
├── routing.test.ts       — 路由测试
├── vision.test.ts        — vision 测试
├── model-override.test.ts  — 模型覆盖测试
├── responses-api.test.ts   — Responses API 集成测试
├── error-handling.test.ts  — 错误处理测试
├── anthropic-to-openai-request.test.ts  — 请求翻译测试
├── openai-to-anthropic-request.test.ts  — 请求翻译测试
├── responses-request.test.ts            — 请求翻译测试
├── responses-response.test.ts           — 响应翻译测试
└── responses-stream.test.ts             — 流翻译测试
```

---

## 入口对比

| 入口 | 目标 | 运行时 | 启动命令 |
|------|------|--------|----------|
| `src/index.ts` | CF Workers, Vercel | Hono (Worker 运行时) | — |
| `server.ts` | Bun 独立, 开发 | Bun 内建 HTTP | `bun run server.ts` |
| `api/[[...route]].ts` | Vercel | Hono (serverless) | — |

---

## 质量约束

| 维度 | 约束 |
|------|------|
| 文件大小 | 多数 ≤300 行（流翻译器例外 ≤450 行） |
| 类型安全 | `as Record<string, unknown>` 业务代码 0 处 |
| 日志 | 生产环境禁止 `console.log` — 在 `IS_DEBUG` 保护下 |
| 测试 | ≥380 测试，全部通过 |
| 翻译器 | 纯函数，无 side effect |
