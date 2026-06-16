---
name: agent-readability
description: 'Optimize code/docs for agent readability. Help AI agents reason about business domains from repo. Triggers on explicit requests: "优化智能体可读性", "agent readability", "让智能体看懂代码", "优化可读性". Do NOT trigger when discussing general readability.'
capabilities: ["readability", "documentation", "knowledge-encoding"]
---

# Agent Readability — Agent Readability Optimization

## Core Concept

**The repo is the system of record.** Information not accessible to agents at runtime effectively does not exist. Knowledge in Google Docs, Slack messages, and human memory cannot be accessed by the system.

## Execution Flow

### Step 1: Tacit Knowledge Audit

Identify knowledge that exists outside the repository:

| Source | Risk | Fix |
|------|------|------|
| Google Docs | Agent cannot access | Migrate to docs/ |
| Slack discussions | Architecture decisions lost | Encode as design docs |
| Human memory | Lost when personnel changes | Encode as AGENTS.md |
| Verbal agreements | Cannot be verified | Encode as linter rules |

### Step 2: Code Readability Optimization

**Naming Optimization:**
- Self-explanatory variable/function names
- Avoid abbreviations (unless widely recognized in the domain)
- Consistency checks

**Context Injection:**
```typescript
// ❌ unreadable
const d = new Date();

// ✅ readable
const subscriptionExpiryDate = new Date(subscription.endDate);
```

**Eliminating Implicit Dependencies:**
```typescript
// ❌ implicit dependency (requires human memory of port)
fetch('http://localhost:3000/api/users');

// ✅ explicit dependency
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
fetch(`${API_BASE_URL}/api/users`);
```

### Step 3: Documentation Readability Optimization

**LLM-friendly Format:**
- Use Markdown instead of PDF
- Structured heading hierarchy
- Code examples instead of plain text descriptions
- Clear "when to read this file" guidance

**Reference Integrity:**
- All cross-references are valid
- No dead links
- Related documents reference each other

### Step 4: Tool Readability Optimization

Ensure agents can directly use project tools:

```bash
# tool help should include
tool --help
# → usage description
# → common examples
# → related tool links
```

### Step 5: Observability Readability

Ensure logs/metrics/traces are queryable by agents:

```json
// structured logging example
{
  "timestamp": "2026-01-01T00:00:00Z",
  "level": "error",
  "message": "Payment failed",
  "user_id": "123",
  "error_code": "CARD_DECLINED",
  "trace_id": "abc123"
}
```

## Input/Output Protocol

**Input:**
- Project codebase
- Existing documentation
- Team knowledge (needs encoding)

**Output:**
- Tacit knowledge audit report
- Code readability improvement suggestions
- Documentation migration plan
- LLM-friendly documentation format

## Quality Standards

- No critical business knowledge outside the repo
- Code naming is self-explanatory
- Documentation uses LLM-friendly format
- All cross-references are valid
