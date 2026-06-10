# QUALITY_SCORE — 质量评分

> **何时读此文件：** 审查项目整体质量状态、查看待改进项、或评估是否达到发布门槛。

## 评分说明

每项满分 10 分。评分基于当前代码库实际状态。

| 维度 | 评分 | 说明 |
|------|------|------|
| **架构合规** | 9/10 | 纯函数分离清晰、路由层统一编排、模块边界明确。扣分：`index.ts` 仍偏长（412 行），可进一步拆分路由分派。 |
| **测试覆盖** | 8/10 | 13 个测试文件覆盖认证、缓存、路由、翻译、流式、视觉、响应、think 标签、背压。新增 `think-tag-stripper.test.ts`（20 用例，覆盖跨 chunk 分割）和 `backpressure.test.ts`（7 用例，覆盖各种 desiredSize）。扣分：`request-handlers.ts` 仍缺少独立单元测试。 |
| **文档完整性** | 7/10 | CLAUDE.md、AGENTS.md、ARCHITECTURE.md 完善。`docs/references/` 有 3 份格式参考文档。扣分：部分 `.md` 文件存在过时内容。 |
| **安全性** | 9/10 | API Key 校验、纯转发无存储、无持久化、请求体最大 10MB 限制、safeJsonBody 捕获解析错误。扣分：API Key 最小长度校验（32 字符）是经验值而非上游策略。 |
| **可维护性** | 7/10 | 模块拆分合理、类型定义清晰、有 eslint/tsconfig。扣分：部分类型使用 `any`（主要在 Responses API 处理中）、注释覆盖率不足。 |
| **性能** | 8/10 | 快速路径优化、最少 JSON 解析、Gzip 压缩、模型列表缓存。扣分：CF Workers 内存受限场景下的流式缓冲区未做背压控制。 |
| **可部署性** | 9/10 | 4 种部署目标（CF/Vercel/Binary/LaunchAgent）+ CI/CD。扣分：CI 中 CF 部署依赖有效 API token，默认不执行。 |

## 总体评分：8.1/10

## 差距分析

### 待改进项

| 差距 | 优先级 | 当前状态 | 目标状态 |
|------|--------|---------|---------|
| Responses API 流式测试 | 中 | 无独立测试 | 添加 `test/responses-stream.test.ts` |
| `any` 类型替换 | 中 | 多处使用 | 替换为精确类型 |
| 背压控制 | 低 | basic yield strategy | 流式响应添加完整背压处理 |
| 结构化日志 | 低 | `console.log` | 接入日志框架 |
| think-tag-stripper 测试 | 已修复 | 20 个测试（非流式 + 流式） | ✅ |
| backpressure 测试 | 已修复 | 7 个测试（desiredSize 各态） | ✅ |
| checkBodySize Content-Length 局限 | 已修复 | async，无 Content-Length 时 clone 读 body | ✅ |

### 已解决的历史问题
- Vercel build 冲突（`build:binary` vs Vercel 自动检测）
- DeepSeek thinking 在模型覆盖后注入错误
- 流式 `<think>` 标签跨 chunk 分割处理
