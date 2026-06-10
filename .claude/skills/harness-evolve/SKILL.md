---
name: harness-evolve
description: 反馈驱动的 Harness 演进。收集执行反馈，持续改进 agents、skills、知识库。当用户说"改进 harness"、"演进"、"harness evolve"、"反馈整合"、"优化 agent 团队"时触发。也用于在每次 harness 执行后主动建议收集反馈。
---

# Harness Evolve — 反馈驱动演进

## 核心理念

**Harness 是演进系统，不是一次性产物。** 每次执行后收集反馈，持续改进 agents、skills 和知识库。

## 执行流程

### Step 1: 反馈收集

每次 harness 执行后，询问用户：

1. "结果有哪些部分需要改进？"
2. "agent 团队组成或工作流程需要调整吗？"
3. "有没有发现智能体重复犯的错误？"

**不强求反馈，但始终提供机会。**

### Step 2: 反馈分类与路由

| 反馈类型 | 修改目标 | 示例 |
|----------|----------|------|
| 输出质量 | 对应 agent 的 skill | "分析太浅" → 在 skill 中增加深度标准 |
| Agent 角色 | Agent 定义 `.md` | "需要安全审查" → 新增 agent |
| 工作流程 | Orchestrator skill | "验证应该前置" → 调整阶段顺序 |
| 团队组成 | Orchestrator + agents | "这两个可以合并" → 合并 agent |
| 触发缺失 | Skill 描述 | "这个表达没触发" → 扩展描述 |

### Step 3: 增量修改

**修改原则：**
- 一次改一个地方
- 修改后立即验证
- 记录变更原因

**修改流程：**
1. 定位修改目标文件
2. 读取现有内容
3. 做出最小化修改
4. 验证修改有效性
5. 更新 CLAUDE.md 变更历史

### Step 4: 变更历史

在 CLAUDE.md 的变更历史表中记录：

```markdown
**Change History:**
| Date | Change | Target | Reason |
|------|--------|--------|--------|
| 2026-01-01 | Initial configuration | All | - |
| 2026-01-05 | 增加安全审查 agent | agents/security.md | 反馈：输出缺少安全审查 |
| 2026-01-10 | 扩展触发描述 | skills/quality-gate | "检查质量"未触发 |
```

### Step 5: 演进触发器

**主动建议演进的情况：**
- 同类反馈重复 2+ 次
- 发现 agent 重复失败的模式
- 用户观察到绕过 orchestrator 手动操作
- 新的技术栈或工具引入

### Step 6: 操作/维护工作流

对已有 harness 进行系统性检查、修改和同步：

1. **状态审计**：对比 agent/skill 文件与 orchestrator 定义的一致性
2. **增量修改**：按用户请求增删改，每次修改后立即同步
3. **更新历史**：记录变更到 CLAUDE.md
4. **变更验证**：结构检查 + 触发验证（如影响触发）

## 输入/输出协议

**输入：**
- 用户反馈
- 执行日志
- 当前 harness 配置

**输出：**
- 修改后的 agent/skill 文件
- 更新的 CLAUDE.md 变更历史
- 演进报告

## 质量标准

- 每次变更记录原因
- 变更后验证一致性
- 不引入新的冲突
- 变更历史完整可追溯
