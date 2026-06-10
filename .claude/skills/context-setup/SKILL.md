---
name: context-setup
description: 生成和维护项目知识库架构。创建 AGENTS.md、docs/ 目录、领域文档。当用户说"设置知识库"、"生成 AGENTS.md"、"创建文档结构"、"context setup"、"知识库初始化"时触发。也用于扩展已有知识库、补充缺失文档。
---

# Context Setup — 知识库架构生成

## 核心理念

**给地图，不给说明书。** AGENTS.md 是目录，不是百科全书。仓库即记录系统——仓库外的知识对智能体不存在。

## 执行流程

### Step 1: 知识审计

1. 扫描项目现有文档（README, docs/, wiki 等）
2. 识别已有知识和缺口
3. 确定目标 AI 工具的上下文特性

### Step 2: 生成 AGENTS.md

AGENTS.md 必须是目录式，包含：

```markdown
# AGENTS.md

## 项目概述
{2-3句话描述项目目的和核心功能}

## 架构地图
- 详见 [ARCHITECTURE.md](ARCHITECTURE.md)
- 分层规则：Types → Config → Repo → Service → Runtime → UI

## 关键约束
- 边界解析：Parse, Don't Validate → 详见 [docs/SECURITY.md](docs/SECURITY.md)
- 品味不变量 → 详见 [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md)
- 安全要求 → 详见 [docs/SECURITY.md](docs/SECURITY.md)

## 工具链
- 构建：{build_command}
- 测试：{test_command}
- 部署：{deploy_command}

## 导航指引
- 新功能？先读 [ARCHITECTURE.md](ARCHITECTURE.md)
- 安全相关？读 [docs/SECURITY.md](docs/SECURITY.md)
- 质量标准？读 [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md)
- 执行计划？读 [docs/exec-plans/](docs/exec-plans/)
```

**限制：不超过 100 行。** 原文明确"大约 100 行"，这是硬约束——超过会挤占任务和代码的上下文空间。

### Step 3: 创建 docs/ 目录结构

```
docs/
├── design-docs/
│   └── index.md
├── exec-plans/
│   ├── active/
│   ├── completed/
│   └── tech-debt-tracker.md
├── generated/
├── product-specs/
│   └── index.md
├── references/
├── DESIGN.md
├── FRONTEND.md
├── PLANS.md
├── PRODUCT_SENSE.md
├── QUALITY_SCORE.md
├── RELIABILITY.md
└── SECURITY.md
```

### Step 4: 生成骨架文档

每个文档生成骨架内容，包含：
- 标题和目的说明
- 待填充的章节结构
- 占位符标记（`<!-- TODO: ... -->`）

### Step 5: 配置新鲜度检查

生成 `.github/workflows/doc-gardening.yml` 或等效配置：
- 定期扫描过时文档
- 检查文档与代码的一致性
- 自动发起修复 PR

## 输入/输出协议

**输入：**
- 项目根目录路径
- 技术栈信息
- 现有文档列表

**输出：**
- `AGENTS.md`
- `docs/` 目录及骨架文档
- 文档新鲜度检查配置

### Step 6: 上下文腐烂（Context Rot）防护

Context Rot 描述模型在上下文窗口填满时推理能力下降的现象。防护策略：

**检测信号：**
- 上下文使用率 >80%
- agent 输出质量下降（重复、遗漏、不一致）
- 同一问题反复出现

**防护措施：**
1. **渐进式披露**：技能按需加载，非启动全量注入
2. **文档精简**：每条信息必须证明占据上下文的合理性
3. **AGENTS.md ≤100 行**：超限时必须拆分到 docs/
4. **定期审计**：扫描不再需要的上下文注入，主动移除

### Step 7: Web Search 与 MCP 工具配置

模型的知识截止于训练日期。为获取实时信息，配置搜索工具：

| 工具 | 用途 | 配置 |
|------|------|------|
| Web Search | 查询最新文档、版本信息 | 内置或 API |
| Context7 | 查询最新库版本和文档 | MCP server |
| GitHub API | 查询 issue、PR、代码搜索 | MCP server |

在 AGENTS.md 中记录可用的搜索工具及使用时机。

## 质量标准

- AGENTS.md ≤ 100 行（硬约束）
- 所有文档包含明确的"何时读此文件"指引
- 无重复信息（每条信息只出现在一个地方）
- 所有交叉引用有效
- Context Rot 防护措施已配置
- 搜索工具可用且记录在 AGENTS.md 中
