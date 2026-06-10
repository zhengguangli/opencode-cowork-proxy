---
name: harness-init
description: 为项目初始化完整的 Harness Engineering 体系。一键生成 agents、skills、知识库架构、CLAUDE.md。当用户说"初始化 harness"、"配置 agent 团队"、"搭建 harness"、"harness init"、"部署 harness"时必须触发。适用于全新项目从零开始的场景。
---

# Harness Init — 一键初始化 Harness 工程体系

## 触发条件

用户要求为项目配置完整的 agent 团队和 harness 体系时触发。

## 执行流程

### Phase 1: 项目探测

1. 扫描项目根目录，识别技术栈（package.json / Cargo.toml / go.mod / pyproject.toml 等）
2. 识别现有目录结构和代码组织方式
3. 检测目标 AI 工具（claude-code / codex / opencode）
4. 检查是否已存在 `.claude/` 目录（避免覆盖）

### Phase 2: 架构设计

调用 `architect` agent：

1. 根据技术栈设计分层架构规则
2. 定义品味不变量（命名、日志、文件大小、类型安全）
3. 生成 `docs/ARCHITECTURE.md`
4. 生成 linter 规则配置

### Phase 3: 知识库搭建

调用 `context-engineer` agent：

1. 生成 `AGENTS.md`（目录式，~100行）
2. 创建 `docs/` 目录结构
3. 生成各领域文档骨架（DESIGN.md, SECURITY.md, RELIABILITY.md 等）
4. 配置知识新鲜度检查

### Phase 4: 技能生成

调用 `builder` agent：

根据项目需求从以下标准技能包中选择并定制：

| 技能 | 用途 | 必选 |
|------|------|------|
| context-setup | 知识库架构管理 | ✅ |
| architecture-guard | 架构边界强制执行 | ✅ |
| entropy-gc | 漂移检测与垃圾收集 | ✅ |
| observability-setup | 可观测性堆栈配置 | 可选 |
| sandbox-exec | 安全代码执行 | 可选 |
| quality-gate | 质量审查门禁 | ✅ |
| agent-readability | 智能体可读性优化 | 可选 |
| harness-evolve | 反馈驱动演进 | ✅ |
| hooks-framework | 确定性执行钩子 | ✅ |

### Phase 5: 质量审查

调用 `reviewer` agent：

1. 检查所有 agent 定义完整性
2. 检查所有 skill frontmatter
3. 检查 CLAUDE.md 指针正确性
4. 检查知识库交叉引用

### Phase 6: 验证

调用 `qa` agent：

1. 结构验证：文件位置、格式、引用
2. 触发验证：每个 skill 的 should-trigger + should-NOT-trigger
3. 干跑验证：orchestrator 阶段序列逻辑性

### Phase 7: 注册 CLAUDE.md

在项目根目录生成 CLAUDE.md，注册 harness 指针：

```markdown
## Harness: {项目名}

**Goal:** {一句话描述}

**Trigger:** 工作请求涉及 {领域} 时，使用对应 skill。简单问题直接回答。

**Change History:**
| Date | Change | Target | Reason |
|------|--------|--------|--------|
| {YYYY-MM-DD} | Initial configuration | All | - |
```

## 输出清单

- [ ] `.claude/agents/` — 7 个 agent 定义文件
- [ ] `.claude/skills/` — 标准技能包
- [ ] `CLAUDE.md` — harness 指针
- [ ] `docs/` — 知识库目录结构及骨架文档
- [ ] `docs/ARCHITECTURE.md` — 架构地图

## 参考资料

- 架构设计：`references/architecture-template.md`
- 知识库模板：`references/docs-template.md`
