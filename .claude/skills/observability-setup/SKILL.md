---
name: observability-setup
description: 配置可观测性堆栈。设置日志、指标、追踪系统，使智能体可查询应用状态。当用户说"配置可观测性"、"设置日志"、"observability"、"监控配置"、"追踪系统"时触发。也用于调整或扩展已有可观测性配置。
---

# Observability Setup — 可观测性堆栈配置

## 核心理念

**可观测性即智能体能力。** 日志/指标/追踪对智能体可查询，是自验证回路的基础。每个工作树拥有临时的可观测性堆栈，任务完成后销毁。

## 执行流程

### Step 1: 需求分析

1. 识别应用技术栈和运行环境
2. 确定需要的信号类型（日志/指标/追踪）
3. 确定查询方式（LogQL/PromQL/TraceQL）

### Step 2: 配置信号采集

**日志采集：**
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

**指标采集：**
```yaml
[sources.app_metrics]
type = "prometheus_scrape"
endpoints = ["http://localhost:9090/metrics"]

[sinks.victoria_metrics]
type = "prometheus_remote_write"
inputs = ["app_metrics"]
endpoint = "http://localhost:8428/api/v1/write"
```

**追踪采集：**
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

### Step 3: 配置查询接口

为智能体提供查询工具：

```bash
# 日志查询
curl -G http://localhost:9428/api/v1/query \
  --data-urlencode 'query={app="myapp"} |= "error"'

# 指标查询
curl -G http://localhost:8428/api/v1/query \
  --data-urlencode 'query=rate(http_requests_total[5m])'
```

### Step 4: 创建 MCP 工具（可选）

为智能体创建可观测性查询的 MCP 工具：

```json
{
  "name": "query_logs",
  "description": "使用 LogQL 查询应用日志",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "LogQL 查询表达式" },
      "start": { "type": "string", "description": "开始时间 (RFC3339)" },
      "end": { "type": "string", "description": "结束时间 (RFC3339)" }
    }
  }
}
```

### Step 5: Chrome DevTools 协议集成

将 Chrome DevTools Protocol 接入智能体运行时，使智能体可直接驱动和验证 UI：

```json
{
  "name": "navigate_and_screenshot",
  "description": "导航到 URL 并截图，用于 UI 验证",
  "inputSchema": {
    "type": "object",
    "properties": {
      "url": { "type": "string" },
      "selector": { "type": "string", "description": "等待的元素选择器" }
    }
  }
}
```

**能力清单：**
- DOM 快照：获取页面结构
- 截图：验证 UI 状态
- 导航：驱动用户流程
- 运行时事件：观察网络请求、控制台日志
- 录屏：录制故障/修复演示视频

### Step 6: 生成 docker-compose

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

## 输入/输出协议

**输入：**
- 项目技术栈
- 应用端口和日志路径
- 部署环境（本地/docker/k8s）

**输出：**
- docker-compose.yml
- vector.toml（信号采集配置）
- MCP 工具定义（可选）
- docs/RELIABILITY.md 更新
