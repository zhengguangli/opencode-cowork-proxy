---
name: sandbox-exec
description: 安全代码执行环境。配置沙箱、命令白名单、网络隔离，使智能体可安全运行代码。当用户说"沙箱"、"安全执行"、"sandbox"、"代码隔离"、"安全运行"时触发。也用于调整沙箱安全策略。
---

# Sandbox Exec — 安全代码执行环境

## 核心理念

**智能体需要安全的操作环境。** 运行智能体生成的代码有风险，沙箱提供隔离执行环境，支持按需创建、扇出执行、任务完成后销毁。

**Bash 是通用执行引擎。** Bash + Code 执行是智能体自主解决问题的关键：
- **自主工具创建**：模型可动态设计自己的工具，而不是受限于预配置的工具集
- **通用问题解决**：给模型"一台计算机"，让它自己想办法
- **代码即工具**：模型可通过编写和执行代码来解决任意问题

**Git 是版本控制原语。** Git 为文件系统添加版本控制能力：
- **工作跟踪**：智能体可跟踪工作进度和历史
- **错误回滚**：出错时可回滚到之前的状态
- **分支实验**：支持在独立分支上尝试不同方案
- **多智能体协作**：多个智能体可通过 git 协调工作

## 执行流程

### Step 1: 环境需求分析

1. 识别项目语言和运行时需求
2. 确定需要的 CLI 工具（git, npm, pytest 等）
3. 确定网络访问需求
4. 确定安全级别

### Step 2: 配置沙箱容器

```dockerfile
FROM ubuntu:22.04

# 基础工具
RUN apt-get update && apt-get install -y \
    git curl wget \
    python3 python3-pip \
    nodejs npm \
    && rm -rf /var/lib/apt/lists/*

# 浏览器（用于 UI 验证和 web 交互）
RUN apt-get update && apt-get install -y \
    chromium-browser \
    chromium-chromedriver \
    && rm -rf /var/lib/apt/lists/*

# 安全配置
RUN useradd -m agent
USER agent
WORKDIR /workspace

# 命令白名单
COPY allowed-commands.txt /etc/allowed-commands.txt
```

**浏览器用途：**
- **UI 验证**：截图、DOM 快照、视觉回归测试
- **Web 交互**：自动化用户流程、表单填写
- **网络观察**：监控网络请求、API 调用
- **录屏证据**：录制故障/修复演示视频

### Step 3: 命令白名单

```bash
# allowed-commands.txt
git
npm
node
python3
pip3
pytest
cargo
go
ls
cat
grep
find
```

### Step 4: 网络隔离

```yaml
# docker-compose.sandbox.yml
services:
  sandbox:
    build: .
    network_mode: "none"  # 完全隔离
    # 或使用自定义网络限制访问
    # networks:
    #   - sandbox-net
    volumes:
      - ./workspace:/workspace
    tmpfs:
      - /tmp:size=512M
```

### Step 5: Git Worktree 隔离

每个任务使用独立的 git worktree，避免状态污染：

```bash
# 为任务创建独立 worktree
WORKTREE=".worktrees/task-$(date +%s)"
git worktree add "$WORKTREE" -b "task-$(date +%s)"

# 在 worktree 中启动沙箱
docker run --rm \
  -v "$(pwd)/$WORKTREE":/workspace \
  --network none \
  sandbox-image \
  bash -c "cd /workspace && npm test"

# 任务完成后清理
git worktree remove "$WORKTREE"
```

**优势：**
- 每个任务有独立的工作目录和分支
- 多个任务可并行执行，互不干扰
- 任务完成后 worktree 可销毁，不留残留状态

### Step 6: 智能体集成

为智能体提供沙箱执行工具：

```bash
# 在沙箱中执行命令
docker run --rm \
  -v $(pwd):/workspace \
  --network none \
  sandbox-image \
  bash -c "cd /workspace && npm test"
```

## 安全策略

| 级别 | 网络 | 命令 | 文件系统 | 适用场景 |
|------|------|------|----------|----------|
| 低 | 允许 | 无限制 | 可写 | 开发环境 |
| 中 | 白名单 | 白名单 | 可写 | 测试环境 |
| 高 | 禁止 | 白名单 | 只读+工作区 | 生产验证 |

## 输入/输出协议

**输入：**
- 项目技术栈
- 安全级别需求
- 网络访问需求

**输出：**
- Dockerfile
- docker-compose.sandbox.yml
- 命令白名单
- 安全策略文档
