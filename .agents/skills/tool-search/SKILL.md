---
name: tool-search
description: 'Dynamic tool discovery. Discover and load tools on demand instead of pre-configured sets. Triggers on explicit requests: "帮我查找工具", "搜索可用工具", "还有什么工具可以用", "列出所有工具". Do NOT trigger when discussing skill configuration.'
---

# Tool Search — Dynamic Tool Discovery

## Core Concept

**Pre-configuring all tools pollutes the context window.** LangChain lists "harnesses that dynamically assemble the right tools and context just-in-time" as a cutting-edge research direction. Tool Search implements progressive tool discovery — the model starts with only core tools loaded and searches for/loads extended tools on demand.

## Execution Flow

### Step 1: Tool Registry

Maintain a tool registry recording metadata for all available tools:

```json
{
  "tools": [
    {
      "name": "web_search",
      "description": "Search the web for latest information",
      "keywords": ["search", "web", "internet", "query"],
      "category": "knowledge",
      "skill": "web-search",
      "dependencies": [],
      "cost": "low"
    },
    {
      "name": "browser",
      "description": "Use headless browser for web operations",
      "keywords": ["browser", "screenshot", "chrome", "puppeteer"],
      "category": "execution",
      "skill": "sandbox-exec",
      "dependencies": ["chromium"],
      "cost": "medium"
    }
  ]
}
```

### Step 2: Tool Search Tool

```json
{
  "name": "tool_search",
  "description": "Search available tools. Returns matching tool list with usage instructions based on natural language query.",
  "parameters": {
    "query": "Natural language description of the need (e.g. 'take screenshot of webpage')",
    "limit": "Max results returned (default 5)"
  }
}
```

### Step 3: Dynamic Tool Loading

```
User request → Model determines unknown tool needed
    → Calls tool_search("screenshot web page")
    → Returns browser tool definition
    → Model loads browser tool into current context
    → Calls browser({action: "screenshot", url: "..."})
```

### Step 4: JIT Context Injection

On-demand loaded tools inject context through progressive disclosure:

1. `tool_search` returns the tool's name + description (1 line)
2. After the model decides to use the tool, load the full parameter schema
3. After the tool is used, unload the detailed schema from context (only keep the call result)

### Step 5: Tool Usage Frequency Tracking

```
.harness-polit/metrics/tool_usage.json
{
  "browser": { "calls": 42, "last_used": "2026-06-10T10:30:00Z" },
  "web_search": { "calls": 18, "last_used": "2026-06-10T09:15:00Z" },
  "apply_patch": { "calls": 156, "last_used": "2026-06-10T10:45:00Z" }
}
```

- High-frequency tools (>50 calls/session) are automatically promoted to preloaded
- Low-frequency tools (<5 calls/session) are demoted to on-demand loading
- New tool cold start: track after first use, decide loading strategy within 3 sessions

## Relationship with Existing Architecture

Tool Search does not replace the existing Skills system but adds a layer of dynamic discovery on top:

```
Skills (11 core, always pre-configured)
    +
Tool Search (extended tool pool, discover and load on demand)
    =
Dynamic + Static hybrid tool strategy
```

**Difference between Skill and Tool:**
- **Skill** = Domain knowledge package (contains Prompts, workflows, reference docs)
- **Tool** = Executable function (contains Schema, implementation, side effects)
- **Tool Search** = The bridge connecting the two

## Input/Output Protocol

**Input:**
- Natural language tool requirement description
- Remaining context window space (determines how many tools can be loaded)

**Output:**
- Matched tool list (name + description + match score)
- Full tool schema (loaded on demand)
- Tool usage frequency report

## Future Directions

- **Automatic Tool Generation**: Model creates temporary tools by writing code (bash as a universal tool)
- **Tool Composition**: Automatically orchestrate multiple tools into workflows
- **Cross-session Tool Preference Learning**: Preload high-probability tools based on historical usage patterns

## Quality Standards

- Tool registry coverage 100% (all available tools are registered)
- tool_search response time < 500ms
- Cold start tool first load latency < 2s
- Tool usage frequency tracking accuracy >95%
- High-frequency tools automatically promoted to preloaded (threshold >50 calls/session)
