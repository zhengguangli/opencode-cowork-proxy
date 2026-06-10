# FRONTEND — API 端点说明

> **何时读此文件：** 调试客户端连接问题、确认支持的 API 端点、了解请求/响应格式。

本项目是 API 翻译网关，无前端 UI。对外暴露以下 HTTP 端点：

## `POST /v1/messages` — Anthropic Messages API 兼容

- **客户端**：Claude Desktop、Claude Code、Anthropic SDK
- **上游格式**：默认翻译为 OpenAI Chat Completions；设 `X-Upstream-Format: anthropic` 则透传到 Anthropic 上游
- **流式**：支持 SSE 流式响应（`stream: true`）
- **图片**：自动检测并路由到上游的视觉模型

## `POST /v1/chat/completions` — OpenAI Chat Completions API 兼容

- **客户端**：OpenAI SDK、OpenAI 兼容客户端
- **上游格式**：默认透传到 OpenAI 上游；设 `X-Upstream-Format: anthropic` 则翻译为 Anthropic Messages 请求
- **流式**：支持 SSE 流式响应

## `POST /v1/responses` — OpenAI Responses API 兼容

- **客户端**：OpenAI Responses SDK、DeepSeek 客户端
- **上游格式**：翻译为 OpenAI Chat Completions 后发送到上游
- **DeepSeek 兼容**：自动注入 `thinking: {type:"enabled"}`（仅在模型以 `deepseek-` 开头且未显式设置 thinking 时）
- **think 标签**：流式和非流式响应均检测并剥离 `<think>` 标签（Minimax 等模型的内联推理文本）
- **流式**：支持 SSE 流式响应
- **图片检测在 thinking 注入之前**：确保视觉模型切换后不会向非 DeepSeek 模型注入不支持的参数

## `GET /` — 健康检查

- **路径**：`GET /`
- **响应**：JSON 包含 `name`、`version`、`status`、`uptime`、`upstream`、`routes`、`endpoints`
- **认证**：不需要 API Key
- **用途**：部署健康检查、uptime 监控、连接验证

## `GET /v1/models` — 模型列表

- **响应**：从上游 `GET /v1/models` 获取，5 分钟缓存（CF Cache API）
- **认证**：需要有效 API Key
- **格式**：根据 `X-Upstream-Format` 头选择上游认证格式（Bearer 或 X-Api-Key）

## 路由前缀

| 前缀 | 作用 | 示例 |
|------|------|------|
| `/go` | 路由到 Go 上游 | `POST /go/v1/messages` |
| `/zen` | 路由到 Zen 上游 | `POST /zen/v1/chat/completions` |
| 无前缀 | 默认 Go 上游 | `POST /v1/messages` |
| `/go/deepseek-v4` | 指定模型名 | `POST /go/deepseek-v4/v1/chat/completions` |

## CORS

所有路径支持 CORS：`Access-Control-Allow-Origin: *`，`OPTIONS` 预检返回 204。
