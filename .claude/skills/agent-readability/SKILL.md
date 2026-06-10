---
name: agent-readability
description: 优化代码和文档的智能体可读性。使 AI 智能体能直接从仓库推理业务域。当用户说"智能体可读性"、"agent readability"、"优化可读性"、"让智能体看懂"时触发。也用于审查现有代码的智能体可读性。
---

# Agent Readability — 智能体可读性优化

## 核心理念

**仓库即记录系统。** 智能体在运行时无法访问的信息等于不存在。Google Docs、Slack 消息、人类记忆中的知识都无法被系统访问。

## 执行流程

### Step 1: 隐性知识审计

识别存在于仓库外的知识：

| 来源 | 风险 | 修复 |
|------|------|------|
| Google Docs | 智能体无法访问 | 迁移到 docs/ |
| Slack 讨论 | 架构决策丢失 | 编码为设计文档 |
| 人类记忆 | 人员变动即丢失 | 编码为 AGENTS.md |
| 口头约定 | 无法验证 | 编码为 linter 规则 |

### Step 2: 代码可读性优化

**命名优化：**
- 变量/函数名自解释
- 避免缩写（除非是领域内公认的）
- 一致性检查

**上下文注入：**
```typescript
// ❌ 不可读
const d = new Date();

// ✅ 可读
const subscriptionExpiryDate = new Date(subscription.endDate);
```

**隐式依赖消除：**
```typescript
// ❌ 隐式依赖（需要人类记忆知道端口）
fetch('http://localhost:3000/api/users');

// ✅ 显式依赖
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
fetch(`${API_BASE_URL}/api/users`);
```

### Step 3: 文档可读性优化

**LLM-friendly 格式：**
- 使用 Markdown 而非 PDF
- 结构化标题层级
- 代码示例而非纯文字描述
- 明确的"何时读此文件"指引

**引用完整性：**
- 所有交叉引用有效
- 无死链
- 相关文档互相引用

### Step 4: 工具可读性优化

确保智能体可直接使用项目工具：

```bash
# 工具帮助信息应包含
tool --help
# → 用途说明
# → 常用示例
# → 相关工具链接
```

### Step 5: 可观测性可读性

确保日志/指标/追踪对智能体可查询：

```json
// 结构化日志示例
{
  "timestamp": "2026-01-01T00:00:00Z",
  "level": "error",
  "message": "Payment failed",
  "user_id": "123",
  "error_code": "CARD_DECLINED",
  "trace_id": "abc123"
}
```

## 输入/输出协议

**输入：**
- 项目代码库
- 现有文档
- 团队知识（需编码）

**输出：**
- 隐性知识审计报告
- 代码可读性改进建议
- 文档迁移计划
- LLM-friendly 文档格式

## 质量标准

- 仓库外无关键业务知识
- 代码命名自解释
- 文档使用 LLM-friendly 格式
- 所有交叉引用有效
