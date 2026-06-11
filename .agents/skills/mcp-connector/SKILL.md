---
name: mcp-connector
description: 'MCP tool connector. Integrate MCP servers (Context7, GitHub API) for real-time knowledge. Triggers on explicit MCP requests: "配置 MCP", "连接 MCP 服务器", "使用 Context7", "MCP 集成". Do NOT trigger when discussing general tools.'
---

# MCP Connector — External Tool Integration

## Core Concept

**An agent's boundary is defined by the tools available to it.** MCP (Model Context Protocol) is the critical channel connecting models to the external world. A Harness without MCP integration is like a computer without network connectivity.

## Core MCP Integrations

### Context7 (Real-time Library Documentation)

**Purpose:** Query the latest library versions, API documentation, and code examples — content beyond the model's training cutoff date.

**Configuration:**
```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"],
      "env": {
        "CONTEXT7_API_KEY": "${CONTEXT7_API_KEY}"
      }
    }
  }
}
```

**Typical Queries:**
- `context7.resolve-library-id("react")` → Get library ID
- `context7.get-library-docs(id, topic="hooks")` → Query topic-specific documentation

### GitHub API (Repositories & Actions)

**Purpose:** Query repository information, manage Issues/PRs, trigger CI/CD.

**Configuration:**
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

**Typical Operations:**
- Create/query Issues and PRs
- Search code and repositories
- Read file contents
- Manage Actions workflows

### Filesystem MCP

**Purpose:** Secure, restricted filesystem access (replaces bare bash file operations).

**Configuration:**
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "allowedDirectories": ["/workspace"]
    }
  }
}
```

## MCP Connection Lifecycle

### Connection State Management

| State | Meaning | Handling |
|------|------|------|
| `connected` | MCP server running normally | Normal usage |
| `disconnected` | Connection interrupted | Auto-reconnect (up to 3 times) |
| `auth_required` | Authentication required | Prompt user to configure API Key |
| `error` | Server error | Log error, fall back to alternatives |

### Startup Health Check

Automatically check the connection status of all configured MCP servers at the start of each session:
1. Call each server's `ping` / `status` endpoint
2. Mark unavailable servers as `disconnected`
3. Generate health report and write to `.harness-polit/mcp_health.json`

## Security Policy

- **Least Privilege**: Each MCP server is granted only necessary permissions
- **Token Management**: API Keys are injected via environment variables, not written to config files
- **Network Isolation**: MCP servers run in sandbox containers (optional)
- **Command Whitelist**: Filesystem MCP restricts access directories
- **Audit Log**: All MCP calls logged to `.harness-polit/trace/`

## Input/Output Protocol

**Input:**
- List of MCP servers to integrate
- API Key / Token configuration
- Security policy parameters

**Output:**
- MCP configuration file (`mcp.json` or equivalent format)
- Health check report
- Tool availability inventory

## Collaboration with context-setup

- context-setup analyzes which MCP tools the project needs in Step 7
- mcp-connector performs the actual configuration and connection management
- Connection status feeds into observability-setup's monitoring dashboard

## Quality Standards

- All MCP server connection statuses are checked at session start
- API Keys injected via environment variables, not written to config files or version control
- Unavailable MCP servers have a clear fallback plan
- Connection retries up to 3 times, exponential backoff
- Audit logs include timestamp, tool name, and result status for all MCP calls
