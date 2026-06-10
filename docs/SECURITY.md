# SECURITY — 安全要求

> **何时读此文件：** 进行安全审查、评估风险、修改认证逻辑、或了解项目的信任边界。

## 认证

- **API Key 来源**：`X-Api-Key` 头或 `Authorization: Bearer <key>` 头
- **验证规则**：Key 必须存在且长度 >= 32 字符
- **失败响应**：401，区分 Anthropic 格式（`{ type: "error", error: { ... } }`）和 OpenAI 格式（`{ error: { ... } }`）
- **注**：本代理不做 API Key 的进一步验证（如查数据库）。Key 直接转发给上游，由上游验证其有效性。本层仅做格式检查和存在性校验。

## 无数据存储

- 本项目是纯转发代理，**不存储任何用户数据**
- 不在磁盘、数据库或缓存中保留请求体、响应体或 API Key
- 模型列表缓存仅缓存可公开的模型元数据，且缓存键不含认证信息
- 无 Session、无 Cookie、无持久化状态

## 请求验证

- **JSON 解析**：`safeJsonBody()` 在解析失败时返回 400，不继续执行
- **URL 解析**：`routeConfig()` 解析 URL，不信任用户提供的路径参数
- **上游 URL**：`X-Upstream-Url` 头必须是一个有效 URL（`new URL()` 验证），无效则忽略
- **请求体大小**：当前无限制。CF Workers 有内置的 100MB 请求体限制。

## 依赖安全

- 运行时依赖：仅 `hono`（轻量 Web 框架）
- dev 依赖：`wrangler`、`vitest`、`typescript`、`@cloudflare/workers-types`
- 定期更新依赖（`bun upgrade`）
- 无原生模块、无第三方 HTTP 客户端（使用全局 `fetch`）

## 传输安全

- 所有上游通信使用 HTTPS（`https://` 前缀硬编码在配置中）
- `X-Upstream-Url` 头同样要求 URL 格式，不支持明文 HTTP 传输
- 无 TLS 终止逻辑（由部署平台处理 — CF Workers、Vercel）

## 部署安全

- API Key 通过环境变量注入，不在代码中硬编码
- LaunchAgent 配置不在 git 中追踪（已 `.gitignore`）
- CF Workers 部署要求 `CF_API_TOKEN` 环境变量（CI/CD 中）

## 无攻击面

以下是本项目**不涉及**的领域（因此无相关攻击面）：
- 无数据库连接
- 无文件上传
- 无用户注册/登录
- 无跨域数据共享（除已配置的 CORS）
- 无第三方服务集成（上游 API 调用是核心功能，非集成）
