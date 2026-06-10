# PLANS

## 项目路线图

### 已完成

| 阶段 | 内容 | 时间 |
|------|------|------|
| 初始化 | Harness 工程体系（7 agent + 11 skill） | 2026-06-09 |
| P0 架构改进 | Handler 拆分 431→7 文件，测试拆分 1074→18 文件 | 2026-06-10 |
| P1 共享提取 | SSE 编码器、finish_reason 映射、response helpers | 2026-06-10 |
| P2 类型安全 | 类型守卫替换 34 处 as Record | 2026-06-10 |
| 文档填充 | ARCHITECTURE/DESIGN/SECURITY/QUALITY_SCORE/FIXES | 2026-06-10 |
| 测试清理 | 27 处 as Record 断言 → 0，2 处 any → 0 | 2026-06-10 |
| 余下文档 | FRONTEND/PLANS/PRODUCT_SENSE/RELIABILITY/design-docs/product-specs/tech-debt | 2026-06-10 |

### 待办

| 优先级 | 项 | 预估 |
|--------|----|------|
| P2 | 流转换器重构（436 行 + 341 行 → 拆分） | 需要设计讨论 |
| P2 | 完整端到端测试套件（含 mock upstream） | ~40 min |
| P3 | 量化性能基准（每秒请求数、P95 延迟） | ~30 min |

### 长期

- Upstream 版本兼容性 CI 检查（上游 API 变更感知）
- 独立二进制自动更新机制
- 更多上游提供商接入
