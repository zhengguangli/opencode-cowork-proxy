# DESIGN

## 设计哲学

### 1. Parse, Don't Validate

JSON 反序列化后的数据结构不可信任。我们不使用 TypeScript `as` 断言强制编译器接受类型——而是编写运行时类型守卫，在类型转换点进行边界检查：

```typescript
// ❌ 运行时崩溃 — 如果 x 不是 Record, usage.prompt_tokens_details 会爆炸
const details = x as Record<string, unknown>;

// ✅ 安全 — 如果 x 不是对象，返回 undefined
const details = asRecordOptional(x);
```

**为什么：** 上游 API 的响应结构可能会在没有通知的情况下变化（新增字段、重命名字段）。类型守卫将错误捕获在边界处，而非在深层访问时崩溃。

**实现：** `src/translate/type-guards.ts` 包含 3 个守卫：`asRecord()`、`asRecordArray()`、`asRecordOptional()`。

### 2. 纯函数翻译器优先

9 个翻译器均为纯函数——接收输入 payload，返回输出 payload，无 I/O、无状态、无副作用。

**原因：**
- **可测试性：** 无需 mock `fetch`、无需模拟运行时环境
- **正确性：** 同一输入始终产生同一输出
- **组合性：** 翻译器可独立验证后接入 handler 层

**例外：** 6 个 stream 翻译器捕获 `ReadableStream` controller 变量，因此不是严格纯函数（闭包持有 controller 引用）。这是与流系统交互的必然结果，但业务逻辑本身无副作用。

### 3. 翻译器 + Handler 分离

翻译层（`src/translate/`）只做格式转换。编排层（`src/handlers/`）处理 I/O：

```
Handler 职责:
  1. 认证
  2. JSON body 解析
  3. 模型覆盖检测
  4. 图像检测
  5. 调用翻译器
  6. safeUpstreamFetch()
  7. 错误处理

Translate 职责:
  1. payload 字段映射
  2. 流事件转换
  3. token 用量映射
```

**为什么：** handler 的 I/O 逻辑不可测试（需要 mock fetch），而翻译器的 payload 变换逻辑可以在内存中单元测试。

### 4. 确定性的请求/响应生命周期

每个请求的处理流程是固定的线性的管道，不是灵活的事件系统：

```
CORS → bodySize → auth → routeConfig → safeJsonBody → translateRequest
  → safeUpstreamFetch → translateResponse → jsonResponse → return
```

**为什么：** 代理的中介角色意味着顺序确定的，不需要可插拔中间件。线性管道易于推理、调试和维护。

### 5. 流式内容块生命周期

在 OpenAI→Anthropic 方向，流式翻译器维护一个块状态机：

```
content_block_start (text/thinking/tool_use)
  → content_block_delta (多个 SSE 事件)
  → content_block_stop
  → (切换块类型)
```

**关键约束：** 每个 `content_block_start` 必须跟随一个 `content_block_stop` 才能切换类型。最常见流式 bug 是在文本和 thinking 块之间缺少 `content_block_stop`。

**实现：** `src/translate/stream/openai-to-anthropic.ts` 使用 `pendingContentType` 和 `inBlock` 状态变量跟踪当前块。

### 6. Responses API 的 DeepSeek Special Handling

OpenAI Responses API path 有 3 个 DeepSeek 特定处理：

1. **Thinking 注入：** 当 body 中模型是 `deepseek-*` 且上游是 Go，自动注入 `{"type":"enabled"}` thinking 参数
2. **`type:"reasoning"` 合并：** DeepSeek 返回的 `type:"reasoning"` 内容块合并到下一个 assistant 消息
3. **`insufficient_system_resource`：** DeepSeek 特殊 finish_reason 映射为 `status:"incomplete"`

**关键排序约束：** 图像检测（`hasResponsesImages()` + `getVisionModel()`）必须在 thinking 注入之前执行——如果图像检测把模型换成了非 DeepSeek 模型，就不能注入 thinking 参数。

### 7. Think Tag 剥离（非流式 + 流式）

某些上游模型（如 minimax-m3-free）在 content 字段嵌入 reasoning 文本，封装在 `<think>` 标签内。两个阶段处理：

```
非流式: 正则替换 /<think>[\s\S]*?<\/think>/g → 空字符串
流式:   ThinkTagStripper 类维护 inTag 状态机 → 跨 chunk 感知开闭标签
```

**为什么流式需要状态机：** SEE chunk 边界可能将 `<think>` 或 `</think>` 标签切分，导致正则无法匹配。状态机跨 chunk 记忆 `inTag` 状态，确保剥离完整。

---

## 字段映射原则

### 通用规则

1. **Anthropic → OpenAI：** 尽量保留原始意图，不做猜测性变换
2. **OpenAI → Anthropic：** 映射到 Anthropic 等价字段，丢失的字段静默丢弃
3. **Responses ↔ Chat Completions：** Chat Completions 作为中介格式

### 关键映射表

| Anthropic | OpenAI | Responses |
|-----------|--------|-----------|
| `messages[{content: [{type:"text", text}]}]` | `messages[{content: string}]` | `input[{type:"message", content:[{type:"input_text", text}]}]` |
| `max_tokens` | `max_tokens` | `max_output_tokens` |
| `stop_sequences` | `stop` | — |
| `system` | `messages[{role:"system"}]` | `instructions` |
| `content_block_delta (text)` | `delta.content` | `type:"output_text" delta` |
| `thinking` | `reasoning_content` | `type:"reasoning"` |

---

## 错误处理策略

### 分层错误响应

```
认证错误 (401)     → { error: { type: "authentication_error", message } }
无效请求 (400)     → { error: { type: "invalid_request_error", message } }
请求过大 (413)     → { error: { type: "invalid_request_error", message } }
上游错误 (!2xx)    → 透传上游 body + 状态码
上游不可达 (502)   → { error: { type: "upstream_error", message } }
上游超时 (499)     → { error: { type: "upstream_error", message: "Request aborted" } }
找不到 (404)       → { error: "Not found" }
```

Anthropic 格式路径（`/v1/messages`、`/v1/models`）的错误响应被包装在 `{ type: "error", error: {...} }` 中，以兼容 Anthropic SDK 的错误解析。

### 重试策略

- **可重试：** 网络错误（Connection refused、DNS 失败）和 5xx 服务端错误
- **不可重试：** 4xx 客户端错误、流请求（SSE 不可重放）
- **最大重试：** 2 次（`MAX_RETRIES`）
- **退避：** `500ms * 2^attempt + random_jitter`，最大 10 秒

---

## 缓存策略

| 缓存对象 | 策略 | TTL |
|----------|------|-----|
| 模型列表 | Cloudflare 缓存 + 内存 | 300s |
| Prompt cache key | djb2 hash of system text | 同请求生命周期 |
| 响应体 | 不缓存 | — |

模型列表使用 CF Workers 的 `caches.default` API 配合 `cf.cacheTtl` 缓存。prompt cache key 用于令牌用量计算，非实际缓存。

---

## 部署策略

### 环境感知行为

| 环境变量 | 效果 |
|----------|------|
| `DEBUG=true` | 开启结构化调试日志（`console.log` 保护） |
| `X-Upstream-Url` header | 覆盖路由上游（任意有效 URL） |
| `X-Upstream-Format` header | 覆盖上游格式（`anthropic` / `openai`） |

### 多部署目标约束

| 约束 | 原因 |
|------|------|
| 版本号从 `package.json` JSON import 获取 | 在所有 4 个运行时中一致 |
| `build` 脚本名不能用于 macOS 二进制 | Vercel 会误解为构建脚本 |
| 服务端 `hono/vercel` adapter 不用 | 某些版本导致构建无限挂起 |

---

## 测试策略

### 分层测试

```
单元测试 (翻译器纯函数)  — 占多数 — 零 mock
集成测试 (handler + fetch) — 使用 vi.spyOn(globalThis, 'fetch')
```

### 测试文件拆分原则

每个测试文件聚焦一个领域：

| 领域 | 文件 | 测试数 |
|------|------|--------|
| 认证 | `test/auth.test.ts` | 5 |
| 路由 | `test/routing.test.ts` | 11 |
| Vision | `test/vision.test.ts` | 9 |
| 模型覆盖 | `test/model-override.test.ts` | 4 |
| Responses API 集成 | `test/responses-api.test.ts` | 7 |
| 错误处理 | `test/error-handling.test.ts` | 8 |
| Anthropic→OpenAI 请求翻译 | `test/anthropic-to-openai-request.test.ts` | 18 |
| OpenAI→Anthropic 请求翻译 | `test/openai-to-anthropic-request.test.ts` | 12 |
| Responses API 请求翻译 | `test/responses-request.test.ts` | 25 |
| Responses API 响应翻译 | `test/responses-response.test.ts` | 10 |
| Responses API 流翻译 | `test/responses-stream.test.ts` | 5 |
| 集成测试入口 | `test/index.test.ts` | 精简为 10 行 |

---

## 设计原则总结

| 原则 | 代码体现 |
|------|----------|
| 显式优于隐式 | 纯函数翻译器，所有依赖通过参数传入 |
| 边界检查 | 类型守卫替代裸 `as` |
| 失败快速 | 请求开头的 bodySize 和 auth 检查 |
| 防御性向上游 | 非 5xx 错误不重试，速率限制头转发给客户端 |
| 最小惊讶 | SSE 格式与标准一致，不添加自定义事件类型 |
| 可恢复性 | 网络错误自动重试，5xx 恢复后继续 |
| 文档即入口 | "WHEN TO READ THIS FILE" 头注释标注每个文件的阅读场景 |
