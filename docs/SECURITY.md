# SECURITY

## 认证流程

所有 API 请求（除健康检查 `GET /` 外）必须提供 API key。

### 密钥提取顺序

1. `X-Api-Key` 请求头（优先级最高）
2. `Authorization: Bearer <key>` 请求头（去除 `Bearer` 前缀）
3. `Authorization: Token <key>` 请求头（去除 `Token` 前缀）

### 密钥验证规则

| 条件 | 结果 |
|------|------|
| 无 API key | 401 `{ error: { type: "authentication_error", message: "Missing API key" } }` |
| API key < 32 字符 | 401 `{ error: { type: "authentication_error", message: "Invalid API key: must be at least 32 characters" } }` |
| API key ≥ 32 字符 | 通过验证，forward 到上游 |

### 认证实现

认证逻辑在 `src/auth.ts` 中实现为纯函数：

```
extractApiKey(headers) → string | null
validateApiKey(key)    → AuthError | null
authErrorResponse(err, path) → Response
```

`authenticateRequest()` 在 `src/request.ts` 中编排三个纯函数。

### 错误格式

Anthropic 路径（`/v1/messages`、`/v1/models`）使用 Anthropic 错误响应格式：
```json
{ "type": "error", "error": { "type": "authentication_error", "message": "..." } }
```

OpenAI 路径使用标准错误格式：
```json
{ "error": { "type": "authentication_error", "message": "..." } }
```

---

## 请求体安全

### 大小限制

- **最大值：** 10 MB（`MAX_BODY_SIZE`）
- **413 响应：** `{ error: { type: "invalid_request_error", message: "Request body exceeds maximum size of 10485760 bytes" } }`
- **检测方法：** 优先使用 `Content-Length` 头（快速路径，不读取 body）；没有 Content-Length 时，clone 请求并读取实际 body

### JSON 解析安全

`safeJsonBody()` 使用 try/catch 包裹 `request.json()`，返回 Result 类型：
- `{ ok: true, data }` — 解析成功
- `{ ok: false, response }` — 解析失败，返回 400 错误响应

---

## CORS 配置

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-Api-Key, Authorization, X-Upstream-Url, X-Upstream-Format, Anthropic-Version, Anthropic-Beta
```

- 所有路径启用 CORS
- OPTIONS 预检请求直接返回 204，不经过认证
- 通配 Origin 适用于浏览器客户端和 Edge 函数

---

## 敏感信息处理

### API Key 传输

- **请求：** 通过 HTTP 头传递（`X-Api-Key` 或 `Authorization: Bearer`）
- **转发：** API key 通过 `anthropicHeaders()` 函数构造 `X-Api-Key` 头转发到上游
- **日志：** 生产环境不记录请求/响应 body，`DEBUG=true` 模式下仅用于开发调试

### 上游 URL 覆盖

`X-Upstream-Url` 请求头允许客户端覆盖路由上游。验证机制：
- 仅检查该值是否为合法 URL（`new URL(header)`）
- 不做域名白名单限制（工具需要灵活性）
- 风险：客户端可重定向到任意 URL

---

## 调试模式隔离

### `IS_DEBUG` 标志

```typescript
export const IS_DEBUG = typeof process !== 'undefined' && process?.env?.DEBUG;
```

- **生产环境：** `IS_DEBUG` 为 `false`，所有 `console.log` / `console.error` 不执行
- **调试模式：** 设置 `DEBUG=true` 环境变量，输出结构化的请求/响应调试信息
- **受保护位置：** handler 文件、stream 翻译器、fetch 重试逻辑

---

## 流请求安全

### SSE 连接管理

- **超时：** 120 秒无数据自动中止（`STREAM_TIMEOUT`）
- **客户端断开：** 通过 `request.signal` 事件监听自动触发上游 abort
- **缓冲区：** 使用 `applyBackpressure()` 防止消费者滞后时无限缓冲

### 背压控制

```
当 controller.desiredSize ≤ 0 时:
  waitMs = min(|desiredSize| × 0.5, 100ms)
  异步等待 waitMs 后继续生产数据
```

---

## 上游通信

### 头转发

认证后的请求转发以下控制头到上游：

```
Content-Type, X-Api-Key, Anthropic-Version, Anthropic-Beta
```

上游响应转发以下速率限制头到客户端：

```
X-Request-Id, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset,
X-RateLimit-Limit-Requests, X-RateLimit-Limit-Tokens
```

### 错误透传

上游非 2xx 响应原样转发到客户端：
- 状态码不变
- 响应 body 不变（不翻译错误）
- `Content-Type`、`Retry-After`、速率限制头不变

---

## 部署安全建议

| 场景 | 建议 |
|------|------|
| 生产部署 | 确保 `DEBUG` 环境变量未设置 |
| API key 管理 | 使用服务端环境变量而非硬编码 |
| 自定义上游 | 自建代理时验证 `X-Upstream-Url` 的目标安全 |
| 速率限制 | 依赖上游的 `RateLimit-*` 限制，代理本身不做速率限制 |
| 日志 | 生产环境使用独立日志服务，避免 `console.log` |

---

## 已知风险

| 风险 | 严重度 | 缓解措施 |
|------|--------|----------|
| `X-Upstream-Url` 可实现 SSRF | 中 | 仅检查 URL 合法性，不自动跟进重定向 |
| API key 通过 HTTP 头明文传递 | 低 | 生产环境应使用 HTTPS |
| 无请求速率限制 | 低 | 依赖上游限流机制 |
| 无 IP 白名单 | 低 | 通配 CORS + 开放部署，适合工具而非公开服务 |
