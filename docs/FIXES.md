# Known Fixes — 已应用的关键修复

> **何时读此文件：** 修改翻译逻辑或流式处理代码前必读，防止重新引入已修复的 bug。新增修复时在本文件追加记录。

本文件记录项目中已应用但容易在重构或版本更新时被遗忘的关键修复。

## Fix 1: Strip `<think>` tags from upstream response content

- **适用模型：** minimax-m3-free 等推理模型
- **问题：** 部分模型在响应中将推理过程以内联 `<think>...</think>` 标签嵌入 text content，而非使用标准 `reasoning_content` 字段。OpenAI Codex CLI 无法解析这些标签，导致输出异常。
- **复现：** 使用 minimax-m3-free 发送任意请求，响应中包含 `<think>` 标签的 content 片段。
- **修复位置：**
  - `src/translate/stream/chat-completions-to-responses.ts` → `stripThinkTags()` 函数。处理跨 chunk 分割的 tag（使用 `inThinkTag` 状态机 + `thinkTagBuffer`）。
  - `src/translate/response/chat-completions-to-responses.ts` → `stripThinkTags()` 函数。使用正则表达式处理非流式响应。
- **验证：** 流式路径测试应验证跨 chunk 边界的 tag 剥离。回归测试关注 minimax 模型。

## Fix 2: Recognize `input_text` content blocks in Responses API

- **适用场景：** OpenAI Codex CLI 通过 Responses API 发送消息
- **问题：** Codex CLI 发送 user/developer 消息时使用 `type: "input_text"` 内容块（而非 `type: "text"`）。`translateUserContent`、`extractTextContent`、`extractTextParts` 函数最初只匹配 `"text"` 和 `"output_text"`，导致所有用户消息内容被忽略，翻译后的 Chat Completions 请求中 user 消息为空。
- **结果：** 模型响应 "Your messages are coming through empty."
- **修复位置：** `src/translate/request/responses-to-chat-completions.ts`
  - `translateUserContent()` — 添加 `|| part.type === "input_text"`
  - `extractTextContent()` — 添加 `|| p.type === "input_text"`
  - `extractTextParts()` — 添加 `|| p.type === "input_text"`
- **验证：** 使用 Codex CLI 发送包含 input_text 的消息，验证翻译后 Chat Completions 请求中的内容非空。

## Fix 3: `hono/vercel` adapter causes build hang

- **适用场景：** Vercel 部署
- **问题：** 使用 `import { handle } from 'hono/vercel'` 并导出 `handle(app)` 会导致 Vercel 构建挂起。
- **修复：** 直接导出 `app.fetch`，不使用 `hono/vercel` 适配器。
- **位置：** `api/[[...route]].ts`
- **验证：** `bunx vercel deploy --prod` 构建成功。

## Fix 4: Vercel model cache fallback

- **适用场景：** Vercel 部署中的 CF 特有 API 兼容
- **问题：** `caches.default` 是 Cloudflare Workers 特有的 API。在 Vercel 上 `typeof caches === "undefined"`。
- **修复：** `src/index.ts` 中的模型缓存逻辑使用可选链 `caches?.default?.put(...)`，在 Vercel 上优雅降级为 no-op。
- **验证：** `GET /v1/models` 在 Vercel 部署上正常返回模型列表（未缓存）。
