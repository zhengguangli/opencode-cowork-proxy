# PRODUCT_SENSE

## 项目定位

OpenCode Cowork Proxy 是一个**翻译网关**，位于 AI 客户端和上游 AI 提供商之间。核心价值：

> 客户端使用任意兼容的 SDK 即可访问上游模型，无需修改客户端代码。

## 目标用户

- **开发者/团队**：使用 Anthropic SDK 但需要通过 OpenAI 兼容提供商访问模型
- **IDE 插件用户**：Claude Code、Continue.dev、Cursor 等工具需要统一代理端点
- **工具集成者**：需要将 AI API 请求路由到特定上游或模型

## 用户场景

### 场景 1：统一代理入口

Claude Code 配置一个 `--proxy` 端点即可访问 OpenCode 上游，无需为每个模型/提供商配置独立密钥：

```
claude-code --proxy http://localhost:18787
```

### 场景 2：模型覆盖

通过在 URL 路径中嵌入模型 ID，绕过 body 中的模型限制：

```
POST /go/deepseek-v4-pro/v1/messages
# → 模型被覆盖为 deepseek-v4-pro，上传到 OpenCode Go
```

### 场景 3：Responses API + DeepSeek

OpenAI Responses API 客户端可透明使用上游的 DeepSeek 模型：

```
POST /v1/responses
{ "model": "deepseek-v4-flash", "input": [...] }
# → 自动翻译为 Chat Completions + 注入 thinking 参数
```

### 场景 4：Vision 自动降级

用户请求一个不支持 Vision 的模型但消息包含图片，代理自动切换到默认 Vision 模型：

```
POST /v1/chat/completions
{ "model": "deepseek-v4-flash", "messages": [{ "content": [{ "type": "image_url", ... }] }] }
# → 模型自动替换为 qwen3.6-plus
```

## 非目标

- 不提供身份认证/用户管理
- 不做请求速率限制（依赖上游）
- 不提供缓存层（除模型列表外）
- 不修改 API 协议的语义（是透传代理，非抽象层）
