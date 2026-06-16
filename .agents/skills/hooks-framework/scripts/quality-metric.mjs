#!/usr/bin/env node

import { writeFileSync, readFileSync, mkdirSync, existsSync, appendFileSync } from 'fs'
import { join } from 'path'
import { parseStdin } from './lib/harness-utils.mjs'

export function qualityMetric(projectDir, metrics = {}) {
  const harnessDir = join(projectDir, '.harness-pilot', 'metrics')
  if (!existsSync(harnessDir)) {
    mkdirSync(harnessDir, { recursive: true })
  }

  const bgTasks = Array.isArray(metrics.background_tasks) ? metrics.background_tasks.length : 0
  const sc = Array.isArray(metrics.session_crons) ? metrics.session_crons.length : 0

  const entry = {
    timestamp: new Date().toISOString(),
    event: metrics.hook_event_name || metrics.event || 'unknown',
    session_id: metrics.session_id || null,
    permission_mode: metrics.permission_mode || null,
    effort_level: metrics.effort?.level || null,
    response_length: metrics.last_assistant_message?.length || 0,
    background_tasks_count: bgTasks,
    session_crons_count: sc,
    ...metrics
  }

  delete entry.last_assistant_message
  delete entry.transcript_path
  delete entry.background_tasks
  delete entry.session_crons
  delete entry.cwd
  delete entry.hook_event_name
  delete entry.stop_hook_active
  delete entry.effort

  const logPath = join(harnessDir, 'quality.jsonl')
  appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8')

  return { 
    success: true, 
    message: 'Quality metric recorded',
    path: logPath
  }
}

if (process.argv[1]?.endsWith('quality-metric.mjs')) {
  let projectDir = process.argv[2] || process.cwd()
  let metrics = {}
  const input = await parseStdin()
  projectDir = input.projectDir || input.cwd || projectDir
  metrics = input
  qualityMetric(projectDir, metrics)
  process.exit(0)
}
