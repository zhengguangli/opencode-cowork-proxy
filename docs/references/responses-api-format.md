# OpenAI Responses API ↔ Chat Completions 参考

## 概要

Responses API (`/v1/responses`) → Chat Completions (`/v1/chat/completions`) 的单向转换。
由 `formatResponsesToChatCompletions()` 和 `streamChatCompletionsToResponses()` 实现。

## 请求映射：Responses → Chat Completions

| Responses API | Chat Completions | 详细 |
|--------------|-----------------|------|
| `input` (单个 `message` 或 `string` 或数组) | `messages` (数组) | `translateUserContent()` / `extractTextContent()` |
| `input[].type:"message"` | `messages[]` | role, content 映射 |
| `input[].type:"reasoning"` | 与下条 assistant 消息合并 | DeepSeek 特殊处理 |
| `input[].type:"tool_call"` | 嵌入 assistant `tool_calls` | `extractToolCalls()` |
| `input[].type:"function_call_output"` | `messages[].role:"tool"` | tool 结果 |
| `input[].content[].type:"input_text"` | `messages[].content` (text) | Codex CLI 风格（见 FIXES.md） |
| `input[].content[].type:"input_image"` | `messages[].content` (image_url) | 图片输入 |
| `previous_response_id` | 注入历史 `messages` | 从对话历史构建 `PriorResponse: ...` 消息 |
| `tools` | `tools` | 直接传递 |
| `tool_choice` | `tool_choice` | `none`/`auto`/`{type:"function","function":{name:"..."}}` |
| `max_output_tokens` | `max_tokens` | 字段重命名 |
| `thinking.type:"enabled"` | (无) | DeepSeek 自动注入 `thinking={type:"enabled"}` |
| `reasoning.effort` | (无) | Anthropic 专用 |
| `store`/`metadata` | (无) | Responses API 专用，不映射 |
| `instructions` | `system` | 作为 system 消息注入 |

### 消息合并规则（DeepSeek 路径）

Responses API 中 `type:"reasoning"` 输入项必须与后续的 `type:"message"` (role:assistant) 合并：
```
Input: [{type:"reasoning",reasoning_text:"..."}, {type:"message",role:"assistant",content:[...]}]
→ messages: [{role:"assistant",content:[...],reasoning_content:"..."}]
```

## 响应映射：Chat Completions → Responses API

| Chat Completions | Responses API | 详细 |
|-----------------|--------------|------|
| `model` | `model` | 传递 `originalModel` |
| `choices[0].message.content` | `output[].content[].type:"output_text"` | 文本输出 |
| `choices[0].message.reasoning_content` | `output[].type:"reasoning"` (独立项) | DeepSeek 推理输出 |
| `choices[0].message.tool_calls` | `output[].type:"function_call"` (独立项) | 函数调用 |
| `choices[0].finish_reason` | `status` → `completed`/`incomplete`/`failed` | `mapFinishReason()` |
| `usage.*` | `usage.*` | `mapUsage()` / `extractCachedTokens()` |
| `id` | `id` (前缀 `resp_`) | 生成 |
| `(无)` | `object:"response"` | 固定值 |
| `(无)` | `created_at` | 当前时间戳 |

### status 映射

```
stop                  → completed
tool_calls            → completed
length                → incomplete
content_filter        → incomplete
insufficient_system_resource → incomplete  (DeepSeek 专有)
```

## 流式映射

| Chat Completions SSE | Responses API SSE | 事件类型 |
|---------------------|-------------------|---------|
| (首个 chunk) | `event: response.created` | `response.created` |
| `delta.content` (首次) | `event: response.output_item.added` | 独立事件 |
| `delta.content` | `event: response.text.delta` | `response.text.delta` |
| `delta.content` (含 `<think>`) | (状态机剥离) | `stripThinkTags()` → 不发射文本 |
| `delta.reasoning_content` | `event: response.reasoning_text.delta` | 推理增量 |
| `delta.tool_calls[].id` | `event: response.output_item.added` + `function_call_arguments.delta` | 函数调用开始 |
| `delta.tool_calls[].function.arguments` | `event: response.function_call_arguments.delta` | 参数增量 |
| (完成一个输出项) | `event: response.content_part.done` + `response.output_item.done` | 项完成 |
| 最终 chunk (含 usage) | `event: response.completed` / `response.incomplete` / `response.failed` | 最终事件 |

### 流式 `<think>` 标签处理

使用状态机处理跨 chunk 的 `<think>...</think>` 标签（见 ThinkTagStripper）：

```
状态: 非 think 模式 → 遇到 <think> → think 模式 → 遇到 </think> → 非 think 模式
```

- Chunk 1: `"正常文本 <think>推理过程"` → 输出 `"正常文本 "` → 标记为 think 模式
- Chunk 2: `"继续推理</think> 后续文本"` → 输出 `" 后续文本"` → 退出 think 模式

## 常见注意事项

1. **<think> 标签剥离**：某些模型（Minimax-m3-free）在 `content` 而非 `reasoning_content` 中嵌入推理，需用状态机剥离（见 FIXES.md）
2. **Tool call 嵌入**：Responses API 中 tool_calls 是独立 output items，Chat Completions 中嵌入在 assistant message 内
3. **Rrace Condition**：Stream 中 `finish_reason` 和 `usage` 可能在同一 chunk 中，也可能在不同 chunk 中到达
4. **DeepSeek `insufficient_system_resource`**：映射为 `status:"incomplete"` 而非 `"completed"`
5. **Backpressure**：当 `controller.desiredSize <= 0` 时，使用 `await new Promise(resolve => setTimeout(resolve, 0))` yield
