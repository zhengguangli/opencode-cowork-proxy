# Sandbox Exec — 安全代码执行环境 (Planned)

> **Sandboxing 为 AI 生成的代码提供隔离、可丢弃的执行环境。**
> 此功能目前处于规划阶段，尚未实现为独立的 skill。

## 状态

`sandbox-exec` 被列为可选 skill（见 `.claude/skills/harness-init/SKILL.md`），但尚未在 `.agents/skills/` 或 `.claude/skills/` 中创建。

## 规划的设计

如果未来实现，每个沙箱将强制执行命令白名单、网络隔离和进程级资源限制：

- **进程隔离** — 代码在独立的 Docker 容器中运行，无权访问主机系统
- **命令白名单** — 只能执行已批准的命令
- **网络隔离** — 可选完整网络隔离或受限的内部网络
- **资源限制** — 强制限制内存 (1GB)、PID 数量 (100) 和超时
- **临时生命周期** — 容器按需创建，任务完成后销毁

## 目录结构（规划）

```
.claude/skills/sandbox-exec/
├── SKILL.md                           # Skill 说明
└── scripts/sandbox/
    ├── Dockerfile                     # 沙箱容器镜像
    ├── docker-compose.sandbox.yml     # Docker Compose 配置
    ├── allowed-commands.txt           # 命令白名单
    ├── entrypoint.sh                  # 容器入口（强制白名单）
    ├── create-worktree.sh             # Git worktree 隔离
    ├── run-in-sandbox.sh              # 通用沙箱执行
    └── run-test-in-sandbox.sh         # 沙箱中的测试运行器
```

## 何时需要

当您需要隔离执行 AI 生成的代码（测试、构建、未知脚本）时，sandbox-exec 可以提供保护。在此之前，所有代码直接在主机上运行。
