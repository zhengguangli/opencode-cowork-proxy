# PLANS — 项目计划总览

> **何时读此文件：** 了解项目路线图、查看已完成的里程碑、确认当前开发阶段。

## 已完成的工作

### 核心翻译层（v1.0 - v2.1）
- 9 个纯函数翻译器覆盖 3 对 3 方向：Anthropic↔Chat Completions、Responses↔Chat Completions
- 每个翻译器分请求、响应、流式三个阶段，共 9 个翻译模块
- 全部翻译器通过单元测试验证（`test/*.test.ts` 共 10 个测试文件）

### 路由与架构
- 路由解析：前缀路由（`/go`、`/zen`、无前缀）+ URL 路径模型覆盖
- 认证模块：API Key 提取与校验（纯函数，无依赖）
- 快速路径优化：字符串扫描先行减少 JSON 解析开销
- 图片检测与视觉模型自动选择
- Gzip 压缩：大于 1KB 的 JSON 响应自动压缩

### 流式支持
- 全部三条路径的 SSE 流式翻译
- 客户端断连检测与上游请求终止（120 秒超时 + request.abort 监听）
- `<think>` 标签状态机剥离（跨 SSE chunk 分割处理）

### 测试
- 10 个测试文件，覆盖认证、缓存、路由、翻译、流式、视觉、响应
- 集成测试使用 `worker.fetch` 端到端模拟
- Mock 策略基于 `vi.spyOn(globalThis, 'fetch')`

### 部署
- Cloudflare Workers（wrangler deploy）
- Vercel serverless（`api/[[...route]].ts` 入口）
- macOS 独立二进制（bun build --compile）
- LaunchAgent 管理本地服务
- GitHub Actions CI/CD（test + deploy）

### Harness 体系（v2 阶段）
- 6 代理 + 4 技能的原始 harness → 完全重建为 7 代理 + 11 技能的工程体系
- 知识库架构（AGENTS.md + docs/ 目录）
- 自动化代码审查、质量门禁、演进反馈

## 当前架构

项目运行双体系：
1. **opencode-cowork-proxy** — API 翻译网关（Hono + CF Workers 运行时）
2. **Harness Engineering** — AI 协作体系（7 agents + 11 skills + 知识库文档）

两者独立但共享仓库。代理代码在 `.claude/` 目录，网关代码在 `src/` 目录。

## 未来方向

### 短期（待办）
- [x] 文档完整性：`docs/references/` 已填充 3 份格式参考文档（Anthropic↔OpenAI、OpenAI↔Anthropic、Responses↔Chat Completions）
- [ ] 重试策略：内置客户端断线重试、5xx 自动重试
- [ ] 测试覆盖补全：Responses API 流式测试、边界条件测试

### 中期
- [ ] 多语言翻译：支持更多上游协议格式（Google AI、AWS Bedrock）
- [ ] 流量管理：请求限流（rate limiting）、并发控制
- [ ] 可观测性：结构化日志、请求追踪、指标暴露
- [ ] 缓存增强：响应缓存（非仅模型列表）

### 长期
- [ ] Health-based 上游故障转移：多上游自动切换
- [ ] 插件系统：允许自定义翻译中间件
- [ ] 管理仪表盘：Web UI 查看代理状态、流量、错误率
