import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

function readFileSafe(path) {
  try { return readFileSync(path, 'utf-8') } catch { return '' }
}

export function compaction(projectDir) {
  const ws = join(projectDir, '.workspace')
  try { mkdirSync(ws, { recursive: true }) } catch {}

  let fileCount = 0
  let totalSize = 0
  try {
    const entries = readdirSync(ws, { recursive: true })
    fileCount = entries.length
    for (const f of entries) {
      try {
        const stat = statSync(join(ws, f.toString()))
        if (stat.isFile()) totalSize += stat.size
      } catch {}
    }
  } catch {}

  // 读取最近的 trace log
  let recentTrace = ''
  const traceDir = join(ws, 'trace')
  if (existsSync(traceDir)) {
    const traceFiles = readdirSync(traceDir).filter(f => f.startsWith('trace_')).sort().slice(-1)
    if (traceFiles.length > 0) {
      const content = readFileSafe(join(traceDir, traceFiles[0]))
      const lines = content.trim().split('\n')
      recentTrace = lines.slice(-5).join('\n')
    }
  }

  // 读取最新的质量指标
  let qualityInfo = ''
  const metricsDir = join(ws, 'metrics')
  if (existsSync(metricsDir)) {
    const metricFiles = readdirSync(metricsDir).filter(f => f.startsWith('quality_')).sort().slice(-1)
    if (metricFiles.length > 0) {
      qualityInfo = readFileSafe(join(metricsDir, metricFiles[0]))
    }
  }

  // 读取当前任务
  const currentTask = existsSync(join(ws, 'current_task.md')) ? readFileSafe(join(ws, 'current_task.md')) : '无任务记录'

  // 读取续行提示（如果有）
  const continuationPrompt = existsSync(join(ws, 'continuation_prompt.md')) ? readFileSafe(join(ws, 'continuation_prompt.md')) : ''

  const summary = `# 上下文摘要

**生成时间:** ${new Date().toISOString()}
**workspace 文件数:** ${fileCount}
**workspace 大小:** ${(totalSize / 1024).toFixed(1)}KB

## 当前任务

${currentTask}

## 最近执行记录

${recentTrace || '无'}

## 质量指标

${qualityInfo || '无'}

${continuationPrompt ? `## 待续行\n\n${continuationPrompt}` : ''}
`

  writeFileSync(join(ws, 'context_summary.md'), summary)
  console.log(summary)

  return { exitCode: 0, message: '[compaction] 摘要已生成' }
}

if (process.argv[1]?.endsWith('compaction.mjs')) {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd()
  const r = compaction(dir)
  if (r.message) console.error(r.message)
  process.exit(0)
}
