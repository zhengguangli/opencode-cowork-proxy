# .workspace/ — Harness Agent 工作空间

> **何时读此文件：** 调试 agent 间数据流、理解中间产物结构、或清除 workspace 时。

`.workspace/` 是 Harness 体系中 agent 间的**中间产物交换目录**。agent 通过在此目录读写文件来传递阶段性结果，而非依赖会话上下文传递。

## 目录结构

```
.workspace/
├── 01_project_analysis.json     # Harness Init 阶段的项目分析快照
├── 07_delivery_manifest.md      # Agent 团队交付清单（阶段总结）
├── metrics/                     # 质量指标时间序列
│   └── quality_YYYY-MM-DD.json  # 每日质量评分快照
└── trace/                       # 会话追踪日志
    └── trace_YYYY-MM-DD.log     # 当日会话日志（git 状态 + hook 事件）
```

## 文件协议

### 项目分析 (`01_*.json`)
Harness Init 阶段生成的项目结构快照，包含技术栈、架构分层、关键模式。后续 agent 在 Phase 0 中读取此文件以获取全局上下文。

### 交付清单 (`07_*.md`)
Harness 搭建完成后输出的总结文档，记录 agent 定制内容、关联输出、运行方式。

### 质量指标 (`metrics/quality_*.json`)
由 `Stop` hook 中的 `quality-metric.mjs` 脚本自动生成，记录：
- `timestamp` — 记录时间
- `metrics.todo_count` — 待办项数量
- `metrics.file_count` — 源码文件数
- `metrics.avg_lines_per_file` — 平均文件行数
- `metrics.large_files` — 超阈值大文件数
- `metrics.recent_commits` — 最近提交数

### 追踪日志 (`trace/trace_*.log`)
由 `Stop` hook 中的 `trace-log.mjs` 脚本自动生成，记录会话级别的事件（git 状态、hook 执行等）。

## 使用规则

1. **Agent 写入约定**
   - 中间产物写入 `filename` 以阶段号开头（`01_`, `02_`, ...）便于排序
   - 最终产物写入项目指定路径，不留在 `.workspace/` 中
   - 文件格式优先 JSON（机器可读）或 Markdown（人机可读）

2. **Agent 读取约定**
   - 新 agent 启动时优先读取 `.workspace/01_*.json` 获取项目上下文
   - 不依赖 `.workspace/` 中的任意文件；若文件缺失，agent 应能优雅 fallback

3. **清理策略**
   - `.workspace/` 是临时产物目录，不提交到 git（已 `.gitignore`）
   - 定期清理老旧指标和追踪文件
