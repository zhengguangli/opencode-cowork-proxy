# Anthropic Messages API → OpenAI Chat Completions 参考

## 请求映射

| Anthropic Messages | OpenAI Chat Completions | 说明 |
|-------------------|------------------------|------|
| `model` | `model` | 直接传递 |
| `system` | `messages[0]` (role: system) | 通过 `hashSystemPrompt()` 注入 cache 控制 |
| `messages[]` | `messages[]` | 逐条转换 |
| `messages[].role: "user"` | `messages[].role: "user"` | content 支持 text/image 块 |
| `messages[].role: "assistant"` | `messages[].role: "assistant"` | content 支持 text/tool_use/thinking 块 |
| `messages[].content: [{type:"image",source:{type:"base64",media_type,data}}]` | `messages[].content: [{type:"image_url",image_url:{url:"data:...;base64,..."}}]` | `translateImageBlock()` |
| `messages[].content: [{type:"tool_use",id,name,input}]` | `messages[].content: [{}]` + `tool_calls` | tool_use → tool_calls |
| `messages[].role: "user"` content 含 `tool_result` | `messages[].role: "tool"` | 格式转换 |
| `tools` | `tools` | 直接传递，仅映射函数结构 |
| `tool_choice` | `tool_choice` | 直接传递 |
| `max_tokens` | `max_tokens` | 直接传递 |
| `stream` | `stream` | 直接传递 |
| `thinking` | (无) | Anthropic 专有，未映射到 OpenAI |
| `metadata` | `user` | 仅传递 `user_id` |

## 响应映射

| OpenAI Chat Completions | Anthropic Messages | 说明 |
|------------------------|-------------------|------|
| `id` | `id` | 直接传递 |
| `model` | `model` | 使用 `originalModel` |
| `choices[0].message.content` | `content[0].text` | 文本内容 |
| `choices[0].message.tool_calls` | `content[].tool_use` 块 | tool_call → tool_use |
| `choices[0].finish_reason` | `stop_reason` | `stop`→`end_turn`, `tool_calls`→`tool_use`, `length`→`max_tokens` |
| `usage.prompt_tokens` | `usage.input_tokens` | 使用 `extractUncachedInputTokens()` 去重缓存 tokens |
| `usage.completion_tokens` | `usage.output_tokens` | 使用 `extractOutputTokens()` |

### finish_reason 映射

```
stop        → end_turn
tool_calls  → tool_use
length      → max_tokens
content_filter → 保留原值
```

## 流式映射

| OpenAI SSE | Anthropic SSE | 说明 |
|-----------|---------------|------|
| `data: {"choices":[{"delta":{"content":"..."}}]}` | `event: content_block_delta\ndata: {"type":"text_delta","text":"...","index":0}` | 文本块增量 |
| `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"..."}}]}}]}` | `event: content_block_delta\ndata: {"type":"input_json_delta","partial_json":"...","index":0}` | tool_call 参数增量 |
| `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"...","function":{"name":"..."}}]}}]}` | 前有 `content_block_start` | 新 tool_use 块开始 |
| `data: {"choices":[],"usage":{...}}` | `event: message_delta\ndata: {"type":"message_delta","usage":{...},"delta":{"stop_reason":"...","stop_sequence":null}}` | 最终 message_delta |

## 常见注意事项

1. **Stream 块生命周期**：每个 `content_block_start` 后必须跟随对应的 `content_block_stop`
2. **Thinking 块**：Anthropic 的 thinking 在 SSE 中为独立 `content_block_start`（类型 `thinking`），OpenAI 无对应
3. **Tool call 参数累积**：多个 SSE chunk 中的 arguments 需要连接
4. **stop_reason `null`**：只有在最终 `message_delta` 中才设置 stop_reason；中间 deltas 不包含
