# FRONTEND

本项目是 API 代理网关（后端服务），**无前端 UI**。

## 客户端交互方式

| 方式 | 说明 |
|------|------|
| HTTP API | 直接的 REST 端点（`/v1/messages`、`/v1/chat/completions` 等） |
| Claude Code 代理 | 设置 `--proxy` 或 `CLAUDE_PROXY` 环境变量指向本服务 |
| 任意 HTTP 客户端 | curl、Postman、Insomnia 等直接发送请求 |

## 推荐客户端配置

### Claude Code

```bash
export CLAUDE_PROXY=http://localhost:18787
# 或
claude-code --proxy http://localhost:18787
```

### curl

```bash
curl -X POST http://localhost:18787/go/v1/messages \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-api-key" \
  -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"Hello"}],"max_tokens":100}'
```

### OpenAI SDK (Python)

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:18787", api_key="your-api-key")
response = client.chat.completions.create(
    model="deepseek-v4-flash",
    messages=[{"role": "user", "content": "Hello"}]
)
```

## 健康检查端点

```
GET /
→ { name: "opencode-cowork-proxy", version: "...", uptime: "...", routes: [...], endpoints: {...} }
```
