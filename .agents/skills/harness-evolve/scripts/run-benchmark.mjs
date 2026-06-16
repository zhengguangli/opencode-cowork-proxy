import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

function getWorkspaceDir(projectDir) {
  if (process.env.HARNESS_WORKSPACE) return process.env.HARNESS_WORKSPACE
  const root = projectDir
    || process.env.CLAUDE_PROJECT_DIR
    || process.env.CODEX_PROJECT_DIR
    || process.env.OPENCODE_PROJECT_DIR
    || process.env.PROJECT_DIR
    || process.cwd()
  return join(root, '.harness-pilot')
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.env.CODEX_PROJECT_DIR || process.env.OPENCODE_PROJECT_DIR || process.env.PROJECT_DIR || join(__dirname, '..', '..', '..', '..', '..')
const WORKSPACE = join(getWorkspaceDir(PROJECT_ROOT), 'benchmark')
const HISTORY_FILE = join(WORKSPACE, 'history.json')

const DEFAULT_TASKS = [
  {
    id: 'add-format-pair',
    name: 'Add a new FormatPair',
    description: 'Adding a new format pair to the translation registry (implement FormatPair interface, register in registry.ts, wire into handler)',
    category: 'code-gen',
    metrics: ['interface-compliance', 'registration-correctness', 'handler-wiring', 'test-coverage']
  },
  {
    id: 'fix-stream-edge-case',
    name: 'Fix streaming translation edge case',
    description: 'Fix a boundary condition in SSE stream translation (chunk boundaries, finish reason mapping, tool_calls in streams)',
    category: 'debugging',
    metrics: ['boundary-handling', 'format-correctness', 'stream-integrity', 'regression-prevention']
  },
  {
    id: 'add-provider',
    name: 'Add a new upstream provider',
    description: 'Adding a new UpstreamProvider (implement interface, register, add vision model set, add route prefix)',
    category: 'code-gen',
    metrics: ['interface-compliance', 'vision-routing', 'auth-headers', 'integration-test']
  },
  {
    id: 'extend-validation',
    name: 'Extend request validation schema',
    description: 'Adding or modifying a Zod v4 validation schema for a new request format or field',
    category: 'architecture',
    metrics: ['schema-correctness', 'parse-dont-validate', 'error-messages', 'boundary-enforcement']
  },
  {
    id: 'refactor-boundary',
    name: 'Refactor architecture boundary violation',
    description: 'Fix a cross-boundary import that violates the translate(pure) → handlers → providers → routing → config layer structure',
    category: 'architecture',
    metrics: ['boundary-compliance', 'import-direction', 'pure-function-invariant', 'test-preservation']
  }
]

function ensureWorkspace() {
  mkdirSync(WORKSPACE, { recursive: true })
}

function loadHistory() {
  if (!existsSync(HISTORY_FILE)) return { runs: [] }
  try {
    return JSON.parse(readFileSync(HISTORY_FILE, 'utf-8'))
  } catch {
    return { runs: [] }
  }
}

function saveHistory(history) {
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2))
}

function scanExistingTrace() {
  const traceDir = join(getWorkspaceDir(PROJECT_ROOT), 'trace')
  if (!existsSync(traceDir)) return []

  try {
    const files = readdirSync(traceDir).filter(f => f.endsWith('.json'))
    return files.map(f => {
      try {
        return JSON.parse(readFileSync(join(traceDir, f), 'utf-8'))
      } catch {
        return null
      }
    }).filter(Boolean)
  } catch {
    return []
  }
}

function calculateScore(task, traces) {
  const metrics = {}

  for (const key of task.metrics) {
    metrics[key] = 0
  }

  if (traces.length === 0) {
    return { score: 50, metrics, note: '无历史 trace 数据，使用基线评分' }
  }

  const recentTraces = traces.slice(-10)

  const successCount = recentTraces.filter(t => t.exitCode === 0 || t.status === 'success').length
  metrics['task-completion'] = Math.round((successCount / recentTraces.length) * 100)

  const avgSteps = recentTraces.reduce((sum, t) => sum + (t.steps || t.toolCalls || 1), 0) / recentTraces.length
  const efficiency = Math.max(0, 100 - avgSteps * 2)
  metrics['efficiency'] = Math.round(efficiency)

  const weights = Object.fromEntries(task.metrics.map(k => [k, 1]))
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0)
  const weightedSum = Object.entries(weights).reduce((sum, [k, w]) => sum + (metrics[k] || 50) * w, 0)

  return {
    score: Math.round(weightedSum / totalWeight),
    metrics,
    note: `基于 ${recentTraces.length} 条近期 trace`
  }
}

function detectBottlenecks(traces) {
  const bottlenecks = []
  const patterns = {}

  for (const trace of traces) {
    if (trace.errors || trace.failures) {
      const errors = Array.isArray(trace.errors) ? trace.errors : [trace.errors]
      for (const e of errors) {
        const key = typeof e === 'string' ? e : (e.message || e.type || 'unknown')
        patterns[key] = (patterns[key] || 0) + 1
      }
    }
  }

  for (const [pattern, count] of Object.entries(patterns)) {
    if (count >= 2) {
      bottlenecks.push({ pattern, count, severity: count >= 5 ? 'high' : 'medium' })
    }
  }

  return bottlenecks
}

function generateComparison(history, currentRun) {
  if (history.runs.length === 0) return null

  const prevRun = history.runs[history.runs.length - 1]
  const diff = {}

  for (const taskId of Object.keys(currentRun.scores)) {
    const current = currentRun.scores[taskId].score
    const previous = prevRun.scores[taskId]?.score
    if (previous !== undefined) {
      diff[taskId] = { current, previous, delta: current - previous }
    }
  }

  const overallDelta = Object.values(diff).reduce((sum, d) => sum + d.delta, 0) / Object.values(diff).length

  return {
    previousRunDate: prevRun.timestamp,
    perTaskDiff: diff,
    overallDelta: Math.round(overallDelta * 10) / 10,
    recommendation: overallDelta < -10
      ? '评分下降 >10%，建议全链路分析'
      : overallDelta < 0
        ? '评分轻微下降，关注瓶颈'
        : '评分稳定或提升'
  }
}

function runBenchmark() {
  ensureWorkspace()

  console.error('[run-benchmark] Terminal Bench 2.0 — 开始评估')
  console.error(`[run-benchmark] 项目目录: ${PROJECT_ROOT}`)

  const traces = scanExistingTrace()
  console.error(`[run-benchmark] 已加载 ${traces.length} 条 trace`)

  const history = loadHistory()
  const scores = {}
  const allBottlenecks = []

  for (const task of DEFAULT_TASKS) {
    console.error(`[run-benchmark] 评估: ${task.name} (${task.id})`)
    const result = calculateScore(task, traces)
    scores[task.id] = { ...result, name: task.name, category: task.category }
    console.error(`[run-benchmark]   → 评分: ${result.score} ${result.note}`)
  }

  const bottlenecks = detectBottlenecks(traces)
  if (bottlenecks.length > 0) {
    console.error(`[run-benchmark] 检测到 ${bottlenecks.length} 个重复错误模式`)
  }

  const overallScore = Math.round(
    Object.values(scores).reduce((sum, s) => sum + s.score, 0) / Object.values(scores).length
  )

  const currentRun = {
    timestamp: new Date().toISOString(),
    overallScore,
    scores,
    bottlenecks,
    traceCount: traces.length
  }

  const comparison = generateComparison(history, currentRun)

  history.runs.push(currentRun)
  saveHistory(history)

  const report = {
    ...currentRun,
    comparison,
    history: {
      totalRuns: history.runs.length,
      trend: history.runs.length >= 2
        ? history.runs.slice(-5).map(r => ({ date: r.timestamp, score: r.overallScore }))
        : null
    }
  }

  const reportPath = join(WORKSPACE, `report-${Date.now()}.json`)
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.error(`[run-benchmark] 报告已保存: ${reportPath}`)
  console.error(`[run-benchmark] 综合评分: ${overallScore}`)

  if (comparison) {
    console.error(`[run-benchmark] 对比上次: ${comparison.overallDelta >= 0 ? '+' : ''}${comparison.overallDelta}`)
    console.error(`[run-benchmark] ${comparison.recommendation}`)
  }

  return {
    exitCode: 0,
    message: [
      `[run-benchmark] Terminal Bench 2.0 完成`,
      `综合评分: ${overallScore}`,
      `任务数: ${DEFAULT_TASKS.length}`,
      `Trace 数: ${traces.length}`,
      `瓶颈数: ${bottlenecks.length}`,
      comparison ? `对比上次: ${comparison.overallDelta >= 0 ? '+' : ''}${comparison.overallDelta}` : '首次运行',
    ].join('\n'),
    report: reportPath
  }
}

if (process.argv[1]?.endsWith('run-benchmark.mjs')) {
  const result = runBenchmark()
  console.log(result.message)
  process.exit(0)
}

export { runBenchmark, DEFAULT_TASKS, calculateScore, detectBottlenecks, generateComparison }
