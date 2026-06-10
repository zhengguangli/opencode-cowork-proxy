---
name: entropy-gc
description: 熵管理与垃圾收集。检测代码漂移、质量退化、技术债务，发起清理 PR。当用户说"垃圾收集"、"代码清理"、"漂移检测"、"entropy gc"、"技术债务"、"质量扫描"时触发。也用于定期自动运行的熵管理任务。
---

# Entropy GC — 熵管理与垃圾收集

## 核心理念

**熵是必然的。** 智能体会复现仓库中已存在的模式——包括不理想的模式。技术债务如高息贷款，小额持续偿还优于累积后批量处理。

## 执行流程

### Step 1: 加载黄金原则

从以下来源加载质量标准：
- `docs/QUALITY_SCORE.md` — 质量评分
- `docs/ARCHITECTURE.md` — 架构约束
- `docs/SECURITY.md` — 安全要求

### Step 2: 漂移扫描

| 扫描维度 | 检查内容 |
|----------|----------|
| 架构漂移 | 依赖方向违规、层次边界突破 |
| 模式漂移 | 不良模式复现、重复代码 |
| 文档漂移 | 过时文档、缺失交叉引用 |
| 工具漂移 | 废弃依赖、未使用的工具 |
| 品味漂移 | 命名不一致、日志格式不统一 |

### Step 3: 质量评分

为每个产品领域和架构层计算质量评分：

```markdown
## Quality Score: {领域名}

| 维度 | 评分 (0-10) | 差距说明 |
|------|------------|----------|
| 架构合规 | 8 | 少量边界违规 |
| 测试覆盖 | 6 | 核心逻辑 85% |
| 文档完整性 | 7 | 缺少 API 文档 |
| 安全性 | 9 | 无已知漏洞 |
| 可维护性 | 7 | 2个过大的文件 |
```

### Step 4: 生成清理 PR

针对发现的问题，生成针对性的修复 PR：

- 每个 PR 聚焦单一问题
- PR 描述包含：问题说明、修复方案、影响范围
- PR 小到可以在 1 分钟内审查

### Step 5: 更新 tech-debt-tracker

将发现的技术债务记录到 `docs/exec-plans/tech-debt-tracker.md`：

```markdown
## Tech Debt Tracker

| ID | 描述 | 严重程度 | 发现日期 | 状态 |
|----|------|----------|----------|------|
| TD-001 | {描述} | {高/中/低} | {日期} | {待修复/修复中/已修复} |
```

## 输入/输出协议

**输入：**
- 项目代码库
- `docs/QUALITY_SCORE.md`
- `docs/ARCHITECTURE.md`

**输出：**
- 漂移扫描报告
- 质量评分更新
- 清理 PR（如有必要）
- `docs/exec-plans/tech-debt-tracker.md` 更新

## 可运行脚本

```
.claude/skills/entropy-gc/
├── SKILL.md
└── scripts/
    ├── drift-scan.sh    ← 漂移扫描（架构、文档、品味、工具）
    └── quality-score.sh ← 质量评分（文件大小、债务、测试、文档）
```

### 快速开始

```bash
# 每日快速扫描（架构漂移 + 文档过期）
.claude/skills/entropy-gc/scripts/drift-scan.sh --quick

# 每周完整扫描（所有维度）
.claude/skills/entropy-gc/scripts/drift-scan.sh --full

# 生成质量评分
.claude/skills/entropy-gc/scripts/quality-score.sh
```

## 自动化配置

### GitHub Actions（推荐）

```yaml
# .github/workflows/entropy-gc.yml
name: Entropy GC
on:
  schedule:
    - cron: '0 8 * * *'   # 每日 08:00 UTC — 快速扫描
    - cron: '0 8 * * 1'   # 每周一 08:00 UTC — 完整扫描
  workflow_dispatch:
      scan_type:
        description: '扫描类型'
        required: true
        default: 'quick'
        type: choice
        options:
          - quick
          - full

permissions:
  contents: write
  pull-requests: write

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Determine scan type
        id: scan
        run: |
          if [[ "${{ github.event_name }}" == "workflow_dispatch" ]]; then
            echo "mode=--${{ github.event.inputs.scan_type }}" >> $GITHUB_OUTPUT
          elif [[ "$(date +%u)" == "1" ]]; then
            echo "mode=--full" >> $GITHUB_OUTPUT
          else
            echo "mode=--quick" >> $GITHUB_OUTPUT
          fi

      - name: Drift scan
        run: |
          .claude/skills/entropy-gc/scripts/drift-scan.sh ${{ steps.scan.outputs.mode }}

      - name: Quality score
        if: steps.scan.outputs.mode == '--full'
        run: |
          .claude/skills/entropy-gc/scripts/quality-score.sh

      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: entropy-reports
          path: .workspace/drift-scan-*.md
          retention-days: 30

      - name: Create issue on drift
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('.workspace/drift-scan-${{ steps.scan.outputs.mode == '--full' && 'full' || 'quick' }}.md', 'utf8');
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `[entropy-gc] 漂移检测报告 ${new Date().toISOString().split('T')[0]}`,
              body: report,
              labels: ['entropy', 'tech-debt']
            });
```

### 本地 Cron（可选）

```bash
# crontab -e
# 每日快速扫描
0 8 * * * cd /path/to/project && .claude/skills/entropy-gc/scripts/drift-scan.sh --quick
# 每周完整扫描
0 8 * * 1 cd /path/to/project && .claude/skills/entropy-gc/scripts/drift-scan.sh --full && .claude/skills/entropy-gc/scripts/quality-score.sh
```
