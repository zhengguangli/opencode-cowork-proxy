# FIXES

本文件记录项目历史上修复过的回归问题和已知 bug，防止重构时再次引入。

---

## Fix 1：`<think>` 标签剥离

**场景：** minimax-m3-free 等模型在 content 字段嵌入 reasoning 文本，封装在 `<think>` 标签内，而非使用标准的 `reasoning_content` 字段。

**影响：** 非 DeepSeek 模型的 Responses API 返回会包含 `<think>...</think>` 文本，污染输出。

**修复（2026-06-09）：**
1. 创建 `src/think-tag-stripper.ts` — 包含 `stripThinkTags()`（非流式，正则）和 `ThinkTagStripper` 类（流式，状态机）
2. 在 `src/translate/response/chat-completions-to-responses.ts` 的非流式路径使用 `stripThinkTags()`
3. 在 `src/translate/stream/chat-completions-to-responses.ts` 的流式路径使用 `ThinkTagStripper`

**关键点：** 流式必须使用状态机而非正则，因为 `<think>`/`</think>` 标签可能被 SSE chunk 边界切分。

**涉及文件：**
- `src/think-tag-stripper.ts`
- `src/translate/response/chat-completions-to-responses.ts`
- `src/translate/stream/chat-completions-to-responses.ts`

---

## Fix 2：`input_text` Content Block 识别

**场景：** Codex CLI 使用 `type: "input_text"` 而非 `type: "text"` 发送用户消息。翻译器只识别 `text` 类型，导致 Codex CLI 消息被忽略。

**影响：** 通过 Responses API 发送的 Codex CLI 用户消息会丢失文本内容。

**修复（2026-06-09）：**
1. 在 `src/translate/request/responses-helpers.ts` 的所有文本提取函数中，检查条件从 `p.type === "text"` 扩展为 `p.type === "text" || p.type === "input_text"`
2. 新增 `extractTextParts()` 函数统一处理多种文本块类型

**涉及文件：**
- `src/translate/request/responses-helpers.ts`（`extractTextContent()`、`extractTextParts()`、`translateUserContent()`）

---

## Fix 3：Vercel Adapter 构建挂起

**场景：** 使用 `hono/vercel` 适配器会导致 Vercel 构建在 Travis/CI 环境中无限挂起。

**影响：** Vercel 部署超时失败。

**修复（2026-06-07）：**
1. `api/[[...route]].ts` 直接 export `app.fetch`（从 `src/index`），不使用 `handle(app)` 包装
2. 独立二进制构建使用 `build:binary` 脚本名，避免 Vercel 误执行

**涉及文件：**
- `api/[[...route]].ts`
- `package.json`（scripts）

---

## Fix 4：模型列表缓存降级

**场景：** Cloudflare Workers 的 `caches.default` 在 local dev (`bun run server.ts`）和部分部署环境中不可用。

**影响：** `caches` 可能为 `undefined`，直接访问会抛出 ReferenceError。

**修复（2026-06-08）：**
1. 使用 `typeof caches !== "undefined"` 守卫包裹所有缓存访问
2. `modelCache` 在缓存不可用时为 `null`，所有 `modelCache.xxx` 调用在 `if (modelCache)` 块内
3. 缓存写入使用 fire-and-forget 模式（不 await 以阻止响应），且在 try/catch 内

**涉及文件：**
- `src/handlers/models.ts`
