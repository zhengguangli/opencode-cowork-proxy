#!/usr/bin/env node
/**
 * quality-metric.mjs — Quality Metrics Recording
 * Records quality metrics for the session
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, appendFileSync } from 'fs'
import { join } from 'path'

export function qualityMetric(projectDir, metrics = {}) {
  const harnessDir = join(projectDir, '.harness-polit', 'metrics')
  if (!existsSync(harnessDir)) {
    mkdirSync(harnessDir, { recursive: true })
  }

  // Build entry from hook event data, extracting meaningful metrics
  const bgTasks = Array.isArray(metrics.background_tasks) ? metrics.background_tasks.length : 0
  const sc = Array.isArray(metrics.session_crons) ? metrics.session_crons.length : 0

  const entry = {
    timestamp: new Date().toISOString(),
    // Hook event identity
    event: metrics.hook_event_name || metrics.event || 'unknown',
    session_id: metrics.session_id || null,
    // Permission & effort
    permission_mode: metrics.permission_mode || null,
    effort_level: metrics.effort?.level || null,
    // Response quality
    response_length: metrics.last_assistant_message?.length || 0,
    // Task tracking
    background_tasks_count: bgTasks,
    session_crons_count: sc,
    // Explicit metrics override (merged last so user fields win)
    ...metrics
  }

  // Clean up - remove huge/redundant fields from persisted entry
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

// CLI mode
if (process.argv[1]?.endsWith('quality-metric.mjs')) {
  let projectDir = process.argv[2] || process.cwd()
  let metrics = {}
  try {
    const raw = readFileSync(0, 'utf-8')
    if (raw.trim()) {
      const input = JSON.parse(raw)
      projectDir = input.projectDir || input.cwd || projectDir
      metrics = input  // Pass entire hook event data, not just input.metrics
    }
  } catch {}
  qualityMetric(projectDir, metrics)
  process.exit(0)
}
