# OpenAI Chat Completions → Anthropic Messages 参考

## 请求映射

| OpenAI Chat Completions | Anthropic Messages | 说明 |
|------------------------|-------------------|------|
| `model` | `model` | 直接传递 |
| `messages[0].role:"system"` | `system` | system 消息提取为顶层字段 |
| `messages[].content` | `messages[].content[]` (块数组) | text → text, image_url → image |
| `messages[].role:"user"` 含 `image_url` | `messages[].role:"user"` 含 `source:{type:"base64",media_type,data}` | `imageSourceFromUrl()` 解析 data URI |
| `messages[].role:"assistant"` 含 `tool_calls` | `messages[].role:"assistant"` 含 `tool_use` 块 | `parseToolArguments()` 安全解析 JSON |
| `messages[].role:"tool"` | `messages[].role:"user"` 含 `tool_result` 块 | role 转换 |
| `tools` | `tools` | function 结构映射 |
| `tool_choice` | `tool_choice` | `auto`/`any`/`none`/`{type:"function",function:{name:"..."}}` |
| `max_tokens` | `max_tokens` | 直接传递 |
| `stream` | `stream` | 直接传递 |
| `temperature` | `temperature` | 直接传递 |
| `top_p` | `top_p` | 直接传递 |
| `stop` | `stop_sequences` | 字符串→数组映射 |
| `user` | `metadata.user_id` | 仅传递 user_id |
| `presence_penalty` | (无) | OpenAI 专有 |
| `frequency_penalty` | (无) | OpenAI 专有 |
| `logit_bias` | (无) | OpenAI 专有 |

## 响应映射

| Anthropic Messages | OpenAI Chat Completions | 说明 |
|-------------------|------------------------|------|
| `id` | `id` | 直接传递，前缀 `msg_` |
| `model` | `model` | 使用 `originalModel` |
| `content[].text` | `choices[0].message.content` | 文本内容 |
| `content[].tool_use` | `choices[0].message.tool_calls[]` | 格式转换 |
| `stop_reason` | `choices[0].finish_reason` | `end_turn`→`stop`, `tool_use`→`tool_calls`, `max_tokens`→`length` |
| `stop_sequence` | `choices[0].stop_sequence` | 直接传递 |
| `usage.input_tokens` | `usage.prompt_tokens` | `extractInputTokens()` |
| `usage.output_tokens` | `usage.completion_tokens` | `extractOutputTokens()` |
| `usage.cache_read_input_tokens` | `usage.prompt_tokens_details.cached_tokens` | 仅当存在时映射 |
| `usage.cache_creation_input_tokens` | (无) | 仅在 Anthropic 格式中存在 |

## 流式映射

| Anthropic SSE | OpenAI SSE | 说明 |
|---------------|-----------|------|
| `event: message_start` | `data: {"choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}` | 仅首个 chunk |
| `event: content_block_start` (type:text) | `data: {"choices":[{"index":0,"delta":{"content":"..."},"finish_reason":null}]}` | 首个文本增量 |
| `event: content_block_delta` (text_delta) | `data: {"choices":[{"index":0,"delta":{"content":"..."},"finish_reason":null}]}` | 文本增量 |
| `event: content_block_start` (type:tool_use) | `data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"...","function":{"name":"...","arguments":""}}]}}]}` | 新 tool_call |
| `event: content_block_delta` (input_json_delta) | `data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"..."}}]}}]}` | tool_call 参数 |
| `event: content_block_stop` | (无显式事件) | OpenAI 无对应 |
| `event: message_delta` | `data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{...}}` | 最终 / 含 usage 的 chunk |
| `event: ping` | (忽略) | 心跳消息，透传不过滤 |

## 常见注意事项

1. **Stream 生命周期**：Anthropic SSE 要求明确的 `content_block_start/delta/stop` 生命周期，OpenAI SSE 无 stop 事件
2. **Tool call 起始**：OpenAI 的 tool_call ID 和 name 在首个 chunk 中随 `function.arguments: ""` 一起到达，Anthropic 要求先 `content_block_start` 独立事件
3. **Tool call 累积**：OpenAI 用 `tool_calls[index]` 标识，Anthropic 用 `content_block` index
4. **Thinking 处理**：Anthropic 有独立的 thinking content_block，OpenAI Chat 无直接对应
5. **[DONE]**：OpenAI 流式必须以 `data: [DONE]` 结束，Anthropic 无此要求
