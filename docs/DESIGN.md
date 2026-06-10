# DESIGN — API 翻译网关设计规范

> **何时读此文件：** 了解 API 翻译的设计决策、格式映射规范、或错误格式约定。

## 设计原则

1. **纯函数优先** — 所有翻译逻辑是纯函数（无 fetch、无副作用），便于测试和推理。路由层负责 IO 编排。
2. **错误透明转发** — 上游错误状态码和响应体原样透传，不尝试翻译错误响应。关键头（Retry-After、RateLimit-*、X-Request-Id）原样转发。
3. **格式感知路由** — 通过 URL 路径前缀（`/go`、`/zen`）和 `X-Upstream-Format` 头决定翻译方向。无前缀时默认走 Go 上游。
4. **最小转化原则** — 尽可能保持请求体不变。仅在需要时执行翻译（格式不匹配、模型覆盖、图片检测）。
5. **快速路径优先** — 图片检测先做字符串扫描（`rawBodyMayHaveImages`），命中后再做完整消息遍历。模型覆盖和图片检测不命中时直接透传原请求体。

## 请求响应格式字段

| 格式 | 请求端点 | 格式特征 |
|------|---------|---------|
| Anthropic Messages | `POST /v1/messages` | `model`、`messages[]`（role+content）、`system`、`stream` |
| OpenAI Chat Completions | `POST /v1/chat/completions` | `model`、`messages[]`（role+content）、`stream`、`tools` |
| OpenAI Responses | `POST /v1/responses` | `model`、`input[]`（type 区分 message/reasoning/tool_call）、`thinking` |

格式参考文档存放于 `docs/references/` 目录，以及 `.claude/skills/field-mapping/` skill 中。

## 状态码映射

| 场景 | 状态码 | 说明 |
|------|--------|------|
| 正常响应 | 200 | 所有翻译路径的成功响应 |
| 认证失败 | 401 | 缺少或无效 API Key |
| 无效请求体 | 400 | JSON 解析失败 |
| 上游错误 | 上游原码 | 原样透传（400、429、500 等） |
| 上游不可达 | 502 | fetch 抛出网络错误 |
| 请求中断 | 499 | 客户端断连或超时 |
| 路径不存在 | 404 | 无匹配路由 |

## 错误格式约定

- **Anthropic 路径**（`/v1/messages`、`/v1/models`）：返回 `{ type: "error", error: { type: "...", message: "..." } }`
- **OpenAI 路径**（`/v1/chat/completions`、`/v1/responses`、`/v1/models`）：返回 `{ error: { type: "...", message: "..." } }`
- **上游错误**：响应体和状态码原样透传，头中携带 `Content-Type`、`Retry-After`、`RateLimit-*`、`X-Request-Id`
