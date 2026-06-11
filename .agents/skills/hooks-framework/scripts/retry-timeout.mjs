#!/usr/bin/env node
/**
 * retry-timeout.mjs — Fault Tolerance
 * Handles retry logic, timeouts, and circuit breaker
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const MAX_RETRIES = 3
const CIRCUIT_BREAKER_THRESHOLD = 5
const CIRCUIT_BREAKER_TIMEOUT = 600000 // 10 minutes

export function retryTimeout(error, toolName, projectDir) {
  const harnessDir = join(projectDir, '.harness-polit', 'metrics')
  if (!existsSync(harnessDir)) {
    mkdirSync(harnessDir, { recursive: true })
  }

  const stateFile = join(harnessDir, 'retry-state.json')
  let state = { tools: {}, lastError: null }

  if (existsSync(stateFile)) {
    try {
      state = JSON.parse(readFileSync(stateFile, 'utf-8'))
      if (!state.tools) state.tools = {}
    } catch {}
  }

  const toolState = state.tools[toolName] || { retries: 0, failures: 0, lastFailure: 0 }
  toolState.retries++
  toolState.failures++
  toolState.lastFailure = Date.now()
  state.tools[toolName] = toolState
  state.lastError = { message: error, timestamp: Date.now() }

  // Save state
  writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8')

  // Check per-tool circuit breaker first (cumulative failures across sessions)
  if (toolState.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    return {
      action: 'circuit_open',
      message: `Circuit breaker open for ${toolName}. Paused for 10 minutes.`,
      retryAfter: CIRCUIT_BREAKER_TIMEOUT
    }
  }

  // Check per-tool max retries for this session
  if (toolState.retries >= MAX_RETRIES) {
    return {
      action: 'give_up',
      message: `Max retries (${MAX_RETRIES}) exceeded for ${toolName}`,
      retries: toolState.retries
    }
  }

  return {
    action: 'retry',
    message: `Retry ${toolState.retries}/${MAX_RETRIES} for ${toolName}`,
    retries: toolState.retries,
    waitTime: Math.pow(2, toolState.retries) * 1000 // Exponential backoff
  }
}

// CLI mode
if (process.argv[1]?.endsWith('retry-timeout.mjs')) {
  let input = {}
  try { const raw = readFileSync(0, 'utf-8'); if (raw.trim()) input = JSON.parse(raw) } catch {}
  const result = retryTimeout(
    input.error || input.error_message || 'Unknown error',
    input.toolName || input.tool_name || 'unknown',
    input.projectDir || input.cwd || process.cwd()
  )
  if (result.halted) console.log(result.message || 'Circuit breaker tripped')
  process.exit(0)
}
