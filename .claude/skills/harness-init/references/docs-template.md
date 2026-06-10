# Docs Directory Template

## 目录结构

```
docs/
├── design-docs/
│   ├── index.md              ← 设计文档索引
│   └── core-beliefs.md       ← 核心理念
├── exec-plans/
│   ├── active/               ← 活跃的执行计划
│   ├── completed/            ← 已完成的执行计划
│   └── tech-debt-tracker.md  ← 技术债务追踪
├── generated/                ← 自动生成的文档
├── product-specs/
│   ├── index.md              ← 产品规格索引
│   └── {feature}.md          ← 各功能规格
├── references/               ← 外部参考（LLM-friendly）
│   └── {tool}-llms.txt       ← 工具/框架参考文档
├── DESIGN.md                 ← 设计系统
├── FRONTEND.md               ← 前端规范
├── PLANS.md                  ← 计划总览
├── PRODUCT_SENSE.md          ← 产品感知
├── QUALITY_SCORE.md          ← 质量评分
├── RELIABILITY.md            ← 可靠性要求
└── SECURITY.md               ← 安全要求
```

## 各文档模板

### docs/DESIGN.md

```markdown
# Design System

## 设计原则
1. {原则1}
2. {原则2}

## 色彩系统
- 主色：{色值}
- 辅助色：{色值}

## 字体系统
- 标题：{字体}
- 正文：{字体}

## 间距系统
- 基础单位：{值}

## 组件规范
- {组件1}：{规范}
- {组件2}：{规范}
```

### docs/SECURITY.md

```markdown
# Security Requirements

## 认证
- {认证方式}

## 授权
- {授权模型}

## 输入验证
- {验证规则}

## 数据保护
- {加密要求}

## 依赖安全
- {依赖扫描策略}
```

### docs/RELIABILITY.md

```markdown
# Reliability Requirements

## 可用性目标
- SLA：{目标}
- 恢复时间：{目标}

## 监控
- 日志：{策略}
- 指标：{策略}
- 告警：{策略}

## 容错
- 重试策略：{策略}
- 熔断策略：{策略}
- 降级策略：{策略}
```

### docs/QUALITY_SCORE.md

```markdown
# Quality Score

## 评分维度

| 维度 | 权重 | 评分标准 |
|------|------|----------|
| 架构合规 | 25% | 依赖方向、层次边界 |
| 测试覆盖 | 25% | 核心逻辑覆盖率 |
| 文档完整性 | 20% | 文档新鲜度、交叉引用 |
| 安全性 | 15% | 漏洞、输入验证 |
| 可维护性 | 15% | 代码清晰度、文件大小 |

## 当前评分

| 领域 | 总分 | 架构 | 测试 | 文档 | 安全 | 可维护 |
|------|------|------|------|------|------|--------|
| {领域1} | - | - | - | - | - | - |
| {领域2} | - | - | - | - | - | - |

## 差距分析
- {差距1}
- {差距2}
```

### docs/exec-plans/tech-debt-tracker.md

```markdown
# Tech Debt Tracker

| ID | 描述 | 严重程度 | 发现日期 | 状态 | 负责人 |
|----|------|----------|----------|------|--------|
| TD-001 | {描述} | {高/中/低} | {日期} | {待修复/修复中/已修复} | - |
```
