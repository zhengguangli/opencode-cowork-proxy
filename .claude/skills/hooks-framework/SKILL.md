---
name: hooks-framework
description: Hooks/中间件框架。定义确定性执行钩子，包括压缩、续行、lint 检查、工具输出卸载。当用户说"配置 hooks"、"中间件"、"hooks framework"、"执行钩子"、"确定性检查"时触发。也用于修改已有 hook 配置。
---

# Hooks Framework — 确定性执行钩子

## 核心理念

**Harness 不仅是工具，还是确定性执行的保障。** Hooks/Middleware 在 agent 执行周期的关键点注入确定性逻辑，弥补模型的不确定性。

## Hook 类型

### 1. Pre-execution Hooks（执行前）

在 agent 开始工作前运行：

| Hook | 触发条件 | 动作 |
|------|----------|------|
| context-check | 每次会话开始 | 检查 AGENTS.md 新鲜度 |
| env-verify | 每次任务开始 | 验证沙箱环境就绪 |
| plan-inject | 复杂任务 | 注入计划文件到上下文 |

### 2. Post-execution Hooks（执行后）

在 agent 完成一轮工作后运行：

| Hook | 触发条件 | 动作 |
|------|----------|------|
| lint-check | 代码变更后 | 运行架构 linter |
| test-run | 代码变更后 | 运行测试套件 |
| quality-gate | PR 创建前 | 质量门禁检查 |

### 3. Interception Hooks（拦截）

在特定信号出现时拦截并重定向：

| Hook | 触发条件 | 动作 |
|------|----------|------|
| continuation | agent 尝试退出 | Ralph Loop：重注入提示 |
| compaction | 上下文 >80% | 压缩并继续 |
| tool-offload | 工具输出 >2000 token | 卸载到文件系统 |

### 4. Observation Hooks（观察）

记录 agent 行为用于后续分析：

| Hook | 触发条件 | 动作 |
|------|----------|------|
| trace-log | 每次工具调用 | 记录输入/输出/耗时 |
| quality-metric | 每次任务完成 | 更新质量评分 |
| drift-detect | 定期 | 检测模式漂移 |

## Hook 配置格式

```yaml
# hooks.yaml
hooks:
  pre_execution:
    - name: context-check
      script: scripts/check-context-freshness.sh
      fail_action: warn
      
  post_execution:
    - name: lint-check
      script: scripts/check-layers.sh
      fail_action: block
    - name: test-run
      script: scripts/run-tests.sh
      fail_action: retry_once
      
  interception:
    - name: continuation
      trigger: agent_exit_without_completion
      action: reinject_prompt
    - name: compaction
      trigger: context_usage_gt_80pct
      action: summarize_and_continue
    - name: tool-offload
      trigger: tool_output_gt_2000_tokens
      action: write_to_file_and_reference
      
  observation:
    - name: trace-log
      script: scripts/log-trace.sh
      always: true
```

## 与 Orchestrator 集成

Hooks 在 orchestrator 的各阶段自动触发：

```
Phase 1: [pre] env-verify → 探测 → [obs] trace-log
Phase 2: [pre] context-check → 架构设计 → [post] lint-check
Phase 3: [pre] plan-inject → 知识库搭建 → [post] quality-gate
Phase 4: [pre] env-verify → 技能生成 → [post] lint-check + test-run
Phase 5: [post] quality-gate → 审查
Phase 6: [post] test-run → 验证
Phase 7: [obs] quality-metric → 注册与交付
```

## 输入/输出协议

**输入：**
- `hooks.yaml` 配置文件
- `scripts/` 目录下的 hook 脚本
- orchestrator 阶段定义

**输出：**
- `hooks.yaml` 配置文件
- `scripts/` 目录下的 hook 脚本
- Hook 执行日志

## 质量标准

- 每个 hook 有明确的触发条件和动作
- Hook 脚本可独立运行和测试
- 失败动作明确（warn/block/retry_once/ignore）
- Hook 执行日志可用于审计
