#!/usr/bin/env node

import { mkdirSync, existsSync, appendFileSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { parseStdin } from './lib/harness-utils.mjs'

export function traceLog(projectDir, logEntry = {}) {
  const harnessDir = join(projectDir, '.harness-pilot')
  const traceDir = join(harnessDir, 'trace')
  if (!existsSync(traceDir)) {
    mkdirSync(traceDir, { recursive: true })
  }

  const hookAction = logEntry.hook_event_name
    || logEntry.action
    || logEntry.tool_name
    || logEntry.toolName
    || (logEntry.session_id ? 'session_end' : 'session_idle')
  const hookMessage = logEntry.last_assistant_message
    || logEntry.message
    || logEntry.output
    || (logEntry.permission_mode ? `Session in ${logEntry.permission_mode} mode` : `Turn at ${new Date().toISOString()}`)

  const entry = {
    timestamp: new Date().toISOString(),
    level: logEntry.level || 'INFO',
    action: hookAction,
    message: typeof hookMessage === 'string' ? hookMessage.substring(0, 200) : String(hookMessage).substring(0, 200),
    ...logEntry
  }

  delete entry.last_assistant_message
  delete entry.transcript_path

  const logPath = join(traceDir, 'execution.jsonl')
  appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8')

  if (logEntry.todos) {
    const todoPath = join(harnessDir, 'todo-state.json')
    writeFileSync(todoPath, JSON.stringify({ 
      todos: logEntry.todos,
      updatedAt: new Date().toISOString()
    }, null, 2), 'utf-8')
  }

  const alertDir = join(harnessDir, 'alerts')
  if (!existsSync(alertDir)) {
    mkdirSync(alertDir, { recursive: true })
  }

  try {
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n').slice(-50)
    const recentEntries = lines.filter(l => l.trim()).map(l => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)

    const errorCounts = {}
    for (const e of recentEntries) {
      if (e.level === 'error' && e.action) {
        if (!errorCounts[e.action]) {
          errorCounts[e.action] = { count: 0, timestamps: [] }
        }
        errorCounts[e.action].count++
        errorCounts[e.action].timestamps.push(e.timestamp)
      }
    }

    for (const [action, data] of Object.entries(errorCounts)) {
      if (data.count >= 3) {
        const routingMap = {
          'hook': 'hooks-framework',
          'tool': 'hooks-framework',
          'phase': 'harness-orchestrator',
          'context': 'context-setup',
          'prompt': 'agent definitions',
        }
        let suggestedRouting = 'general review'
        for (const [keyword, route] of Object.entries(routingMap)) {
          if (action.toLowerCase().includes(keyword)) {
            suggestedRouting = route
            break
          }
        }

        const alertContent = [
          `# Error Pattern Alert`,
          ``,
          `**Pattern:** ${action}`,
          `**Occurrences:** ${data.count}`,
          `**Timestamps:**`,
          ...data.timestamps.map(t => `- ${t}`),
          ``,
          `**Suggested routing:** ${suggestedRouting}`,
        ].join('\n')

        const alertPath = join(alertDir, `pattern-alert-${Date.now()}.md`)
        writeFileSync(alertPath, alertContent, 'utf-8')
      }
    }
  } catch {}

  return { 
    success: true, 
    message: 'Trace logged',
    path: logPath
  }
}

if (process.argv[1]?.endsWith('trace-log.mjs')) {
  let projectDir = process.argv[2] || process.cwd()
  let input = {}
  try {
    const raw = readFileSync(0, 'utf-8')
    if (raw.trim()) {
      input = JSON.parse(raw)
      projectDir = input.projectDir || input.cwd || projectDir
    }
  } catch {}
  traceLog(projectDir, input)
  process.exit(0)
}
