---
name: sandbox-exec
description: 'Secure code execution environment. Sandbox, command allowlists, network isolation. Triggers on explicit requests: "配置沙箱", "安全执行环境", "sandbox setup", "代码隔离", "安全运行配置". Do NOT trigger when discussing general security.'
---

# Sandbox Exec — Secure Code Execution Environment

## Core Philosophy

**Agents need a safe execution environment.** Running agent-generated code carries risk. Sandboxes provide isolated execution environments, supporting on-demand creation, fan-out execution, and destruction after task completion.

**Bash is the universal execution engine.** Bash + Code execution is key to autonomous agent problem-solving:
- **Autonomous tool creation**: Models can dynamically design their own tools, rather than being limited to a pre-configured toolset
- **General problem solving**: Give the model "a computer" and let it figure things out
- **Code as tool**: Models can solve arbitrary problems by writing and executing code

**Git is the version control primitive.** Git adds version control capabilities to the filesystem:
- **Work tracking**: Agents can track work progress and history
- **Error rollback**: Roll back to previous state on errors
- **Branch experimentation**: Support trying different approaches on independent branches
- **Multi-agent collaboration**: Multiple agents can coordinate work through git

## Shell Tool Specification

**Bash is the universal execution engine, but raw bash calls are uncontrollable.** Based on OpenAI Codex's `shell_command` standard, define a unified Shell tool interface.

### Standard Shell Tool Schema

```json
{
  "name": "shell_command",
  "description": "Execute a command in the user's default shell and return output. Always set the workdir parameter; avoid using cd in command strings.",
  "parameters": {
    "command": "Shell command to execute (string, not array)",
    "workdir": "Working directory (recommended to always set)",
    "timeout_ms": "Timeout in milliseconds (default 120000)",
    "with_escalated_permissions": "Whether out-of-sandbox permissions are needed (bool)",
    "justification": "Reason for elevated permissions (required only when with_escalated_permissions=true)"
  }
}
```

### Guidance on Dedicated Terminal Wrapper Tools

When limiting the model's access to raw terminal, create dedicated tools consistent with underlying commands:

- **Tool names and output formats mirror native commands**: e.g., `list_dir` instead of `terminal('ls')`
- **Parameters and return formats align with commands**: Models are primarily trained on terminal tools; staying close to native commands preserves distribution alignment
- **Declare in prompts to prefer dedicated tools**: e.g., "for git operations, please use the `git` tool rather than `shell_command`"

### Dedicated Git Tool Example

```json
{
  "name": "git",
  "description": "Execute git commands. Usage matches the git CLI.",
  "parameters": {
    "command": "Git command string (e.g. 'status', 'diff', 'log --oneline')",
    "workdir": "Repository root directory path"
  }
}
```

### view_image Tool

Standard image viewing tool for verifying UI screenshots, design mockups, diagrams, etc.:

```json
{
  "name": "view_image",
  "description": "Load a local image file into the conversation context for the model to view.",
  "parameters": {
    "path": "Local filesystem path to the image file"
  }
}
```

## Browser Tool Encapsulation

The browser is core bundled infrastructure. Chromium is already installed in the current Dockerfile and needs further encapsulation as a tool agents can directly invoke.

### Browser Tool Schema (Playwright encapsulation)

```json
{
  "name": "browser",
  "description": "Execute web operations using a headless browser. Supports navigation, screenshots, DOM queries, form interaction.",
  "parameters": {
    "action": "navigate | screenshot | click | type | evaluate | pdf",
    "url": "Target URL (required for navigate)",
    "selector": "CSS selector (required for click/type/evaluate)",
    "value": "Input value or JavaScript code (required for type/evaluate)",
    "full_page": "Whether to take full-page screenshot (bool, default false)"
  }
}
```

### Typical Usage Scenarios

| Scenario | Operation | Purpose |
|------|------|------|
| UI verification | `screenshot` | Capture full or partial page screenshots, visual regression comparison |
| Form interaction | `navigate` + `type` + `click` | Automate user flows, end-to-end testing |
| DOM inspection | `evaluate` | Execute JS to get page state, performance metrics |
| Network monitoring | `evaluate` | Intercept network requests, verify API calls |
| PDF reports | `pdf` | Generate page PDF as evidence attachments |

### Browser Security

- Always run inside sandbox container (network isolation + read-only filesystem)
- Prohibit access to localhost and internal network addresses
- Browser processes auto-terminate after task completion (timeout 60s)

### Computer Use Tool

**Computer Use** is the combined capability of browser, shell, and screenshot — agents can operate GUI interfaces like a human.

```json
{
  "name": "computer_use",
  "description": "Simulate human computer operation: view screen, move mouse, click, type. Used for GUI application interaction and automated testing.",
  "parameters": {
    "action": "screenshot | click | type | key | mouse_move | scroll | wait",
    "x": "Mouse X coordinate (required for click/mouse_move)",
    "y": "Mouse Y coordinate (required for click/mouse_move)",
    "text": "Text to type (required for type)",
    "keys": "Key combination like 'Enter', 'Ctrl+C' (required for key)"
  }
}
```

**Applicable scenarios:**
- **GUI application testing**: Operate non-web desktop applications (via VNC)
- **Acceptance testing**: Record + replay user interaction sequences
- **Accessibility verification**: Tab navigation + screen reader compatibility
- **Installation wizards**: Automate software installation processes

**Security constraints:**
- Computer Use is only enabled in high-security sandboxes (`network_mode: none`)
- Interaction sequences have a hard timeout (30s per step)
- Screenshot before execution → Execute → Screenshot after execution, fully audited

## Quality Standards

- Sandbox container startup time < 60s
- Command allowlist covers all necessary development tools
- Complete network isolation between sandboxes (`network_mode: none`)
- Sandbox auto-destroyed after task completion (no residual containers)
- Browser process auto-terminated after 60s timeout

## Execution Flow

### Step 1: Environment requirements analysis

1. Identify project language and runtime requirements
2. Determine required CLI tools (git, npm, pytest, etc.)
3. Determine network access requirements
4. Determine security level

### Step 2: Configure sandbox container

```dockerfile
FROM ubuntu:22.04

# Base tools
RUN apt-get update && apt-get install -y \
    git curl wget \
    python3 python3-pip \
    nodejs npm \
    && rm -rf /var/lib/apt/lists/*

# Browser (for UI verification and web interaction)
RUN apt-get update && apt-get install -y \
    chromium-browser \
    chromium-chromedriver \
    && rm -rf /var/lib/apt/lists/*

# Security configuration
RUN useradd -m agent
USER agent
WORKDIR /workspace

# Command allowlist
COPY allowed-commands.txt /etc/allowed-commands.txt
```

**Browser use cases:**
- **UI verification**: Screenshots, DOM snapshots, visual regression testing
- **Web interaction**: Automated user flows, form filling
- **Network observation**: Monitor network requests, API calls
- **Screen recording evidence**: Record failure/fix demonstration videos

### Step 3: Command allowlist

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

### Step 4: Network isolation

```yaml
# docker-compose.sandbox.yml
services:
  sandbox:
    build: .
    network_mode: "none"  # Complete isolation
    # Or use a custom network to restrict access
    # networks:
    #   - sandbox-net
    volumes:
      - ./workspace:/workspace
    tmpfs:
      - /tmp:size=512M
```

### Step 5: Git Worktree isolation

Each task uses an independent git worktree to avoid state pollution:

```bash
# Create an independent worktree for the task
WORKTREE=".worktrees/task-$(date +%s)"
git worktree add "$WORKTREE" -b "task-$(date +%s)"

# Start sandbox in the worktree
docker run --rm \
  -v "$(pwd)/$WORKTREE":/workspace \
  --network none \
  sandbox-image \
  bash -c "cd /workspace && npm test"

# Clean up after task completion
git worktree remove "$WORKTREE"
```

**Advantages:**
- Each task has an independent working directory and branch
- Multiple tasks can run in parallel without interference
- Worktrees can be destroyed after task completion, leaving no residual state

### Step 6: Agent integration

Provide sandbox execution tools for agents:

```bash
# Execute commands in the sandbox
docker run --rm \
  -v $(pwd):/workspace \
  --network none \
  sandbox-image \
  bash -c "cd /workspace && npm test"
```

## Security Policy

| Level | Network | Commands | Filesystem | Applicable Scenarios |
|------|------|------|----------|----------|
| Low | Allowed | Unlimited | Writable | Development environment |
| Medium | Allowlist | Allowlist | Writable | Test environment |
| High | Blocked | Allowlist | Read-only + workspace | Production verification |

## Input/Output Protocol

**Input:**
- Project tech stack
- Security level requirements
- Network access requirements

**Output:**
- Dockerfile
- docker-compose.sandbox.yml
- Command allowlist
- Security policy documentation
