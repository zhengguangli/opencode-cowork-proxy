#!/usr/bin/env node
/**
 * trace-log.mjs — Execution Logging
 * Logs execution traces and syncs todo state
 */

import { mkdirSync, existsSync, appendFileSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'

export function traceLog(projectDir, logEntry = {}) {
  const harnessDir = join(projectDir, '.harness-pliot')
  const traceDir = join(harnessDir, 'trace')
  if (!existsSync(traceDir)) {
    mkdirSync(traceDir, { recursive: true })
  }

  // Log to execution trace — extract useful fields from various hook event schemas
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

  // Clean up — remove huge fields that bloat the trace log
  delete entry.last_assistant_message
  delete entry.transcript_path

  const logPath = join(traceDir, 'execution.jsonl')
  appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8')

  // Sync todo state if provided
  if (logEntry.todos) {
    const todoPath = join(harnessDir, 'todo-state.json')
    writeFileSync(todoPath, JSON.stringify({ 
      todos: logEntry.todos,
      updatedAt: new Date().toISOString()
    }, null, 2), 'utf-8')
  }

  return { 
    success: true, 
    message: 'Trace logged',
    path: logPath
  }
}

// CLI mode
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
