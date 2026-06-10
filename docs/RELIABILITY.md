# RELIABILITY — 可靠性要求

> **何时读此文件：** 配置部署环境、评估 SLA 要求、理解错误处理和超时策略。

## 可用性

- **运行时**：Cloudflare Workers edge network（99.95%+ SLA）、Vercel serverless、macOS 独立二进制
- **无单点故障**：多部署目标，上游路由可切换
- **服务状态**：`GET /` 返回 `{"status": "ok"}` + 版本号和运行时间
- **启动时间**：CF Workers 冷启动 < 50ms，Vercel 冷启动 < 200ms

## 超时策略

| 场景 | 超时 | 行为 |
|------|------|------|
| 非流式请求 | 60s | `AbortSignal.timeout(60_000)` |
| 流式请求 | 120s | `AbortSignal.timeout(120_000)` + 客户端断连自动中止 |
| 模型列表 | 10s | `AbortSignal.timeout(10_000)` |
| 客户端中断 | 即时 | request.signal 'abort' 事件触发上游 abort |

## 重试策略

**当前状态：无内置重试。**

`safeUpstreamFetch()` 在失败时返回错误响应（499/502），不进行自动重试。未来补充：

- [ ] 5xx 响应自动重试（最多 2 次，指数退避）
- [ ] 429 响应等待 Retry-After 头后重试
- [ ] 网络错误（502）自动重试
- [ ] 流式中断后重连

## 健康检查

- **端点**：`GET /`
- **响应**：`{ name, version, status: "ok", uptime, upstream, routes, endpoints }`
- **认证**：无需 API Key
- **频率**：外部监控每分钟检查
- **失败处理**：非 "ok" 状态通知部署平台自动重启

## 速率限制

- **内置限制**：当前无内置 rate limiting。依赖上游的 rate limit 头。
- **头透传**：`RateLimit-Limit`、`RateLimit-Remaining`、`RateLimit-Reset`、`X-RateLimit-Limit-Requests`、`X-RateLimit-Limit-Tokens` 原样转发给客户端。
- **Retry-After**：上游 429 响应中的 `Retry-After` 头原样透传。

## 错误隔离

- 翻译器是纯函数，失败不会影响其他请求
- `safeJsonBody()` 捕获 JSON 解析错误，返回 400
- `safeUpstreamFetch()` 捕获网络错误，返回 502
- 认证失败直接返回 401，不发起上游请求

## 缓存

- 模型列表：CF Cache API，5 分钟 TTL（`Cache-Control: public, max-age=300`）
- 缓存失败不阻塞响应（fire-and-forget 模式）
- 缓存键基于 URL + format，不带认证信息（安全，因为模型列表与认证无关）
