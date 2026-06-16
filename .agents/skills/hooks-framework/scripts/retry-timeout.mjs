#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { parseStdin } from './lib/harness-utils.mjs'

const MAX_RETRIES = 3
const CIRCUIT_BREAKER_THRESHOLD = 5
const CIRCUIT_BREAKER_TIMEOUT = 600000

export function retryTimeout(error, toolName, projectDir) {
  const harnessDir = join(projectDir, '.harness-pilot', 'metrics')
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

  const now = Date.now()
  const toolState = state.tools[toolName] || { retries: 0, failures: 0, successes: 0, lastFailure: 0, lastSuccess: 0, resetAt: 0 }

  if (!error) {
    toolState.successes++
    toolState.lastSuccess = now
    if (toolState.successes > 0 && toolState.failures > 0) {
      toolState.failures--
    }
    state.tools[toolName] = toolState
    writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8')
    return {
      action: 'success',
      message: `${toolName} succeeded`,
      successes: toolState.successes,
      failures: toolState.failures
    }
  }

  toolState.retries++
  toolState.failures++
  toolState.lastFailure = now
  state.tools[toolName] = toolState
  state.lastError = { message: error, timestamp: now }

  if (toolState.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    if (!toolState.resetAt) {
      toolState.resetAt = now + CIRCUIT_BREAKER_TIMEOUT
      state.tools[toolName] = toolState
      writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8')
    }
    if (now < toolState.resetAt) {
      return {
        action: 'circuit_open',
        message: `Circuit breaker open for ${toolName}. Paused for 10 minutes.`,
        retryAfter: toolState.resetAt - now
      }
    } else {
      toolState.resetAt = 0
      toolState.failures = CIRCUIT_BREAKER_THRESHOLD - 1
      state.tools[toolName] = toolState
      writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8')
      return {
        action: 'retry',
        message: `Circuit breaker half-open for ${toolName}. Allowing retry.`,
        retries: toolState.retries,
        waitTime: 0
      }
    }
  }

  writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8')

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
    waitTime: Math.pow(2, toolState.retries) * 1000
  }
}

if (process.argv[1]?.endsWith('retry-timeout.mjs')) {
  const input = await parseStdin()
  const result = retryTimeout(
    input.error || input.error_message || 'Unknown error',
    input.toolName || input.tool_name || 'unknown',
    input.projectDir || input.cwd || process.cwd()
  )
  if (result.halted) console.log(result.message || 'Circuit breaker tripped')
  process.exit(0)
}
