# tech-debt-tracker — 技术债务追踪

## 活跃条目

| ID | 标题 | 领域 | 影响 | 优先级 | 备注 |
|----|------|------|------|--------|------|
| TD-004 | `console.log` 作为日志手段 | 可观测性 | 生产环境无结构化日志 | 低 | 已全部 IS_DEBUG 门控，`scripts/check-debug-log.sh` 改进了检测精确度 |
| TD-008 | 流式无背压控制 | 性能 | CF Workers 内存受限场景 | 低 | 大流式响应可能 OOM |
| TD-014 | `tsc --noEmit` 报告 40+ 类型错误 | 类型系统 | 多数由 `as`/`Record<string,unknown>` 导致 | 低 | 已修复 cache.ts/config.ts/index.ts/request.ts/responses-to-chat-completions.ts 中的类型错误，剩余 48 处主要在 stream/response 翻译器（先存） |

## 已关闭条目

| ID | 标题 | 关闭原因 | 关闭日期 |
|----|------|---------|---------|
| TD-009 | Vercel build 与 binary build 冲突 | 已重命名为 `build:binary` | 2026-05 |
| TD-010 | DeepSeek thinking 注入顺序错误 | 图像检测改到 thinking 注入前 | 2026-06 |
| TD-011 | 快速路径缺失 | 已添加 `rawBodyMayHaveImages` 字符串扫描先行 | 2026-06 |
| TD-013 | `index.ts` 超 10 个 import | 创建 `src/translate/index.ts` barrel export 减少到 7 | 2026-06 |
| TD-012 | `chat-completions-to-responses.ts` 超 500 行 | 提取 `ThinkTagStripper` 到共享模块，文件 507→458 行 | 2026-06 |
| TD-002 | `docs/references/` 为空 | 填充 3 个格式参考骨架文档 | 2026-06 |
| TD-006 | 无内置重试策略 | 实现指数退避重试（5xx 时自动重试）及 2 个集成测试 | 2026-06 |
| TD-007 | `index.ts` 主处理函数过长 | 提取 5 个独立路由函数到 `src/request-handlers.ts`，index.ts 427→70 行 | 2026-06 |
| TD-001 | `any` 类型 74 处 | 逐步替换为 `Record<string, unknown>`，全量消除 | 2026-06 |
| TD-015 | 骨架文档 TODO 占位符 | docs/design-docs/ 和 docs/product-specs/ 改用指向现有文档的引用 | 2026-06 |
| TD-016 | `.workspace/` 未 gitignored | 加入 .gitignore + 清空目录 | 2026-06 |
| TD-017 | server-stream.test.ts 不存在但被 ARCHITECTURE.md 引用 | 删除引用，替换为实际存在的 test 文件 | 2026-06 |

## 优先级定义

- **高**：立即影响正确性或智能体工作效率
- **中**：在特定场景下影响质量或开发效率
- **低**：值得改进但不紧急

## 迁移到 `active/` 规则

当开始处理某个条目时，将其从本文件移出，创建独立执行计划文件到 `docs/exec-plans/active/` 目录。完成后归档到 `docs/exec-plans/completed/`。
