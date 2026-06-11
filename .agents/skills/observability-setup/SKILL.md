---
name: observability-setup
description: 'Observability stack setup. Logs, metrics, tracing so agents can query app state. Triggers on explicit requests: "配置可观测性", "设置监控", "添加日志", "配置 metrics", "observability setup". Do NOT trigger when discussing general logging.'
---

# Observability Setup — Observability Stack Configuration

## Core Philosophy

**Observability is agent capability.** Logs/metrics/traces are queryable by agents and form the foundation of the self-verification loop. Each worktree gets a temporary observability stack that is destroyed after task completion.

## Execution Flow

### Step 1: Requirements analysis

1. Identify application tech stack and runtime environment
2. Determine required signal types (logs/metrics/traces)
3. Determine query methods (LogQL/PromQL/TraceQL)

### Step 2: Configure signal collection

**Log collection:**
```yaml
# vector.toml
[sources.app_logs]
type = "file"
include = ["/var/log/app/*.log"]

[sinks.victoria_logs]
type = "loki"
inputs = ["app_logs"]
endpoint = "http://localhost:3100"
```

**Metrics collection:**
```yaml
[sources.app_metrics]
type = "prometheus_scrape"
endpoints = ["http://localhost:9090/metrics"]

[sinks.victoria_metrics]
type = "prometheus_remote_write"
inputs = ["app_metrics"]
endpoint = "http://localhost:8428/api/v1/write"
```

**Trace collection:**
```yaml
[sources.app_traces]
type = "opentelemetry"
grpc.port = 4317
http.port = 4318

[sinks.victoria_traces]
type = "otlp"
inputs = ["app_traces"]
endpoint = "http://localhost:4317"
```

### Step 3: Configure query interface

Provide query tools for agents:

```bash
# Log query
curl -G http://localhost:9428/api/v1/query \
  --data-urlencode 'query={app="myapp"} |= "error"'

# Metrics query
curl -G http://localhost:8428/api/v1/query \
  --data-urlencode 'query=rate(http_requests_total[5m])'
```

### Step 4: Create MCP tools (optional)

Create MCP tools for agent observability queries:

```json
{
  "name": "query_logs",
  "description": "Query application logs using LogQL",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "LogQL query expression" },
      "start": { "type": "string", "description": "Start time (RFC3339)" },
      "end": { "type": "string", "description": "End time (RFC3339)" }
    }
  }
}
```

### Step 5: Chrome DevTools Protocol integration

Integrate Chrome DevTools Protocol into the agent runtime so agents can directly drive and verify UI:

```json
{
  "name": "navigate_and_screenshot",
  "description": "Navigate to a URL and take a screenshot for UI verification",
  "inputSchema": {
    "type": "object",
    "properties": {
      "url": { "type": "string" },
      "selector": { "type": "string", "description": "Element selector to wait for" }
    }
  }
}
```

**Capability list:**
- DOM snapshot: Get page structure
- Screenshot: Verify UI state
- Navigation: Drive user flows
- Runtime events: Observe network requests, console logs
- Screen recording: Record failure/fix demonstration videos

### Step 6: Generate docker-compose

**Full solution (suitable for large projects):**

```yaml
version: '3.8'
services:
  victoria-logs:
    image: victoriametrics/victoria-logs:latest
    ports: ["9428:9428"]
  victoria-metrics:
    image: victoriametrics/victoria-metrics:latest
    ports: ["8428:8428"]
  victoria-traces:
    image: victoriametrics/victoria-traces:latest
    ports: ["4317:4317", "4318:4318"]
  vector:
    image: timberio/vector:latest
    volumes: ["./vector.toml:/etc/vector/vector.toml"]
```

### Step 7: Lightweight solution (for small/personal projects)

No need for the full VictoriaMetrics suite. Use stdout + file logging + simple queries:

**Approach: Structured logging + jq query**

```bash
# 1. App outputs structured logs to stdout
# 2. Logs collected to file (handled by process manager or docker)
# 3. Query with jq/grep

# Query error logs
cat app.log | jq 'select(.level == "error")'

# Query by time range
cat app.log | jq 'select(.timestamp > "2026-01-01T00:00:00Z")'

# Query by user
cat app.log | jq 'select(.user_id == "123")'
```

**Node.js example (pino):**

```javascript
const pino = require('pino');
const logger = pino({ level: 'info' });

logger.info({ user_id: '123', action: 'login' }, 'User logged in');
logger.error({ err: error, user_id: '123' }, 'Payment failed');
```

**Python example (structlog):**

```python
import structlog
logger = structlog.get_logger()

logger.info("user_logged_in", user_id="123", ip="1.2.3.4")
logger.error("payment_failed", user_id="123", error_code="CARD_DECLINED")
```

**Lightweight docker-compose (logs only):**

```yaml
version: '3.8'
services:
  app:
    build: .
    volumes:
      - ./logs:/app/logs
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

**When to choose which solution:**

| Solution | Applicable Scenarios | Complexity |
|------|----------|--------|
| Full solution | Multi-service, needs metrics/tracing, team collaboration | High |
| Lightweight solution | Single service, personal project, logs are sufficient | Low |

## Input/Output Protocol

**Input:**
- Project tech stack
- Application ports and log paths
- Deployment environment (local/docker/k8s)

**Output:**
- docker-compose.yml
- vector.toml (signal collection configuration)
- MCP tool definitions (optional)
- docs/RELIABILITY.md update

## Quality Standards

- All three signals (logs/metrics/traces) are queryable
- Query interfaces are accessible to all agents
- docker-compose starts with one command, no additional configuration needed
- Lightweight solution can use `jq` instead of Grafana for log queries
- Screenshot evidence save path is standardized (`.harness-polit/evidence/`)
