# Sandbox Exec — Secure Code Execution Environment

> **Sandboxing provides isolated, disposable execution environments for agent-generated code.**
> Each sandbox enforces command allowlists, network isolation, and process-level resource limits.

## Overview

This project uses Docker-based sandbox containers to run agent-generated code safely. The sandbox setup provides:

- **Process isolation** — code runs in a separate container with no access to the host system
- **Command allowlist** — only approved commands can be executed
- **Network isolation** — optional full network isolation or restricted internal network
- **Resource limits** — memory (1GB), PID count (100), and timeout enforced
- **Ephemeral lifecycle** — containers are created on demand and destroyed after task completion

## Directory Structure

```
.agents/skills/sandbox-exec/
├── SKILL.md                           # Skill instructions
└── scripts/sandbox/
    ├── Dockerfile                     # Sandbox container image
    ├── docker-compose.sandbox.yml     # Docker Compose configuration
    ├── allowed-commands.txt           # Command allowlist
    ├── entrypoint.sh                  # Container entrypoint (enforces allowlist)
    ├── create-worktree.sh             # Git worktree isolation
    ├── run-in-sandbox.sh              # Generic sandbox execution
    └── run-test-in-sandbox.sh         # Test runner in sandbox
```

## Security Levels

| Level | Network | Commands | Filesystem | When to Use |
|-------|---------|----------|------------|-------------|
| **Full Isolation** (default) | `network_mode: none` | Allowlist enforced | Writable workspace | Running untrusted code, tests, build |
| **Restricted Network** | Internal bridge, no internet | Allowlist enforced | Writable workspace | When tools need local network access (e.g., wrangler dev) |
| **Dev** (no sandbox) | Full access | Unlimited | Full access | Local development speed (not for agent use) |

## Usage

### 1. Run tests in sandbox (full isolation)

```bash
# All tests
.agents/skills/sandbox-exec/scripts/sandbox/run-test-in-sandbox.sh

# Single test file
.agents/skills/sandbox-exec/scripts/sandbox/run-test-in-sandbox.sh test/auth.test.ts
```

### 2. Run any command in sandbox

```bash
# Default (full isolation)
.agents/skills/sandbox-exec/scripts/sandbox/run-in-sandbox.sh bun test

# Restricted network mode
.agents/skills/sandbox-exec/scripts/sandbox/run-in-sandbox.sh --restricted npx wrangler whoami
```

### 3. Create isolated worktree for a task

```bash
.agents/skills/sandbox-exec/scripts/sandbox/create-worktree.sh my-feature-task
```

This creates a new git worktree at `.worktrees/my-feature-task/` on branch `task/my-feature-task`.

**Why worktrees?**
- Each task gets an independent working directory and branch
- Multiple tasks can run in parallel without state pollution
- Worktrees can be destroyed after task completion with `git worktree remove`

### 4. Build sandbox image manually

```bash
docker build -t sandbox-exec:latest \
  -f .agents/skills/sandbox-exec/scripts/sandbox/Dockerfile .
```

The image is automatically built on first use by `run-in-sandbox.sh`.

## Command Allowlist

The allowlist at `allowed-commands.txt` restricts which commands can be executed inside the sandbox. It includes:

- **Version control**: `git`
- **Runtimes**: `bun`, `bunx`, `node`, `npm`, `npx`
- **Shell**: `bash`, `sh`, `ls`, `cat`, `grep`, `find`, etc.
- **Filesystem**: `mkdir`, `cp`, `mv`, `rm`, `chmod`, etc.
- **Build**: `make`, `cc`, `gcc`, `g++`
- **Utilities**: `jq`, `curl`, `wget`, `tar`, `python3`, `pip3`

**Prohibited**: `sudo`, `docker`, `ping`, `nc`, `ssh`, `scp`, `rsync`, `netcat`, `socat`

## Agent Integration

Agents use the sandbox for executing code, running tests, and verifying changes. The SRE (Site Reliability Engineer) agent is responsible for sandbox environment configuration.

### Recommended agent workflows

#### Running tests after code changes
```bash
.agents/skills/sandbox-exec/scripts/sandbox/run-test-in-sandbox.sh
```

#### Task-level isolation with worktree + sandbox
```bash
# 1. Create isolated worktree
.agents/skills/sandbox-exec/scripts/sandbox/create-worktree.sh fix-auth-bug

# 2. Work in the worktree
cd .worktrees/fix-auth-bug/

# 3. Run tests in sandbox
.agents/skills/sandbox-exec/scripts/sandbox/run-test-in-sandbox.sh

# 4. Clean up
git worktree remove .worktrees/fix-auth-bug/
git branch -D task/fix-auth-bug
```

## Docker Requirements

- **Docker Desktop** (macOS): Install from [docker.com](https://docs.docker.com/get-docker/)
- **Docker Engine** (Linux): `sudo apt install docker.io docker-compose-v2`
- Minimum version: Docker 24+ with Compose V2

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `docker: command not found` | Install Docker Desktop or Engine |
| `command not allowed by allowlist` | Check `allowed-commands.txt`, or adjust command |
| `permission denied` on scripts | Run `chmod +x scripts/sandbox/*.sh` |
| Docker build fails | Ensure Docker is running and has internet access on first build |
| Container timeout | Increase `stop_timeout` in `docker-compose.sandbox.yml` |
