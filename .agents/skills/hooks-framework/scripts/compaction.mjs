#!/usr/bin/env node

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { parseStdin } from './lib/harness-utils.mjs'

export function compaction(projectDir) {
  const harnessDir = join(projectDir, '.harness-pilot')
  if (!existsSync(harnessDir)) {
    mkdirSync(harnessDir, { recursive: true })
  }

  let tasks = []
  const todoFile = join(harnessDir, 'todo-state.json')
  if (existsSync(todoFile)) {
    try {
      const todoData = JSON.parse(readFileSync(todoFile, 'utf-8'))
      tasks = (todoData.todos || []).filter(t => t.status === 'pending' || t.status === 'in_progress')
    } catch {}
  }

  let recentLogs = []
  const traceDir = join(harnessDir, 'trace')
  if (existsSync(traceDir)) {
    try {
      const traceFile = join(traceDir, 'execution.jsonl')
      if (existsSync(traceFile)) {
        const lines = readFileSync(traceFile, 'utf-8').trim().split('\n')
        recentLogs = lines.slice(-5).map(line => {
          try { return JSON.parse(line) } catch { return null }
        }).filter(Boolean)
      }
    } catch {}
  }

  let metrics = null
  const metricsFile = join(harnessDir, 'metrics', 'quality.jsonl')
  if (existsSync(metricsFile)) {
    try {
      const lines = readFileSync(metricsFile, 'utf-8').trim().split('\n')
      const lastLine = lines[lines.length - 1]
      if (lastLine) metrics = JSON.parse(lastLine)
    } catch {}
  }

  let workspaceStats = { fileCount: 0 }
  try {
    const skip = new Set(['node_modules', '.git', '.harness-pilot', 'target', 'dist', 'build'])
    function countFiles(dir) {
      let count = 0
      let entries
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return 0 }
      for (const e of entries) {
        if (skip.has(e.name)) continue
        const full = join(dir, e.name)
        if (e.isDirectory()) count += countFiles(full)
        else if (e.isFile()) count++
      }
      return count
    }
    workspaceStats.fileCount = countFiles(projectDir)
  } catch {}

  const summary = `# Context Summary

Generated: ${new Date().toISOString()}
Workspace file count: ${workspaceStats.fileCount}

## Current Tasks

${tasks.length > 0 
  ? tasks.map(t => `- [${t.status === 'in_progress' ? '→' : ' '}] ${t.content}`).join('\n')
  : 'No tasks recorded'}

## Recent Execution Logs

${recentLogs.length > 0
  ? recentLogs.map(log => {
      const time = log.timestamp ? new Date(log.timestamp).toISOString().replace('T', ' ').slice(0, 19) : '?'
      const action = log.action || log.hook_event_name || log.tool_name || log.toolName || ''
      const detail = log.message || log.last_assistant_message || log.data || log.output || ''
      if (!action && !detail) return `${time} [${log.level || 'INFO'}]`
      const detailStr = typeof detail === 'string' ? detail.substring(0, 120) : JSON.stringify(detail)
      return `${time} [${log.level || 'INFO'}] ${action}: ${detailStr}`
    }).join('\n')
  : 'No execution logs'}

## Quality Metrics

${metrics 
  ? JSON.stringify(metrics, null, 2)
  : 'No quality metrics'}
`

  const summaryPath = join(harnessDir, 'context_summary.md')
  writeFileSync(summaryPath, summary, 'utf-8')

  return { 
    success: true, 
    message: 'Compaction summary generated',
    path: summaryPath,
    data: {
      tasks: tasks.length,
      logs: recentLogs.length,
      hasMetrics: !!metrics
    }
  }
}

if (process.argv[1]?.endsWith('compaction.mjs')) {
  let projectDir = process.argv[2] || process.cwd()
  const input = await parseStdin()
  projectDir = input.projectDir || input.cwd || projectDir
  compaction(projectDir)
  process.exit(0)
}
