---
name: web-search
description: 'Web search integration. Query latest docs, version info, real-time data beyond training cutoff. Triggers ONLY on explicit search requests: "帮我搜索", "查一下最新", "需要联网搜索", "上网查一下". Do NOT trigger when discussing skills, tools, or configuration.'
capabilities:
  - search
  - retrieval
---

# Web Search — Real-time Information Retrieval

## Core Concept

**The model's knowledge cutoff is a hard limit.** Web Search is a core Harness primitive that enables agents to access new library versions, API changes, current documentation, and real-time data that appeared after the training data cutoff.

## Execution Flow

### Step 1: Requirements Analysis

1. Identify task types that require real-time information
2. Determine search frequency and caching strategy
3. Select search provider (API / built-in)

### Step 2: Search Tool Definition

```json
{
  "name": "web_search",
  "description": "Search web for latest info. Query docs, library versions, API changes beyond model knowledge cutoff.",
  "parameters": {
    "query": "Search query string",
    "max_results": "Number of results (default 5, max 10)",
    "topic": "general | news | docs (optional, default general)"
  }
}
```

### Step 3: Web Fetch Tool Definition

```json
{
  "name": "web_fetch",
  "description": "Fetch URL content and convert to markdown. For reading specific pages from search results.",
  "parameters": {
    "url": "Target URL",
    "format": "markdown | text | html (default markdown)"
  }
}
```

### Step 4: Search Strategy

| Scenario | Strategy | Example |
|------|------|------|
| New library version | Search `{package} changelog latest` | `react changelog 19.0` |
| API changes | Search `{library} migration guide` | `next.js 15 migration guide` |
| Documentation lookup | Directly fetch official docs URL | `https://docs.example.com/api` |
| Real-time data | Search `{topic} 2026` | `node.js LTS schedule 2026` |
| Error troubleshooting | Search `{error message}` | `TypeError: Cannot read properties of undefined` |

### Step 5: Result Caching

- Cache search results to `.harness-pliot/search_cache/` (TTL: 1 hour)
- Do not repeat requests for the same query within TTL
- Cache files named by query hash: `{query_hash}.json`

### Step 6: Security & Compliance

- Do not search or fetch internal network addresses
- Respect robots.txt and website terms of use
- Annotate search results with source URL and fetch time
- Sensitive projects can configure search domain whitelist

## Input/Output Protocol

**Input:**
- Search query or target URL
- Result count requirement
- Search type preference

**Output:**
- Structured search results (title, URL, summary)
- Fetched page markdown content
- Source attribution and timestamp

## Collaboration with context-setup

- context-setup's Step 7 defines which search/MCP tools the project needs
- web-search skill provides the actual search execution capability
- Search results can feed into context-setup to update the knowledge base

## Quality Standards

- Search results always annotated with source URL and timestamp
- Cache hit rate >60% (reduce duplicate requests)
- Search response time < 5s
- Do not search internal network addresses or sensitive domains
- Respect robots.txt and website terms of use
