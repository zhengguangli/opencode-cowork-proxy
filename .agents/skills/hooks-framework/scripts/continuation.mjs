#!/usr/bin/env node
/**
 * continuation.mjs — Ralph Loop Continuation Detection
 * Detects if agent needs to continue working
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export function continuation(projectDir) {
  const harnessDir = join(projectDir, '.harness-polit')
  
  // Check for pending tasks
  const pendingFile = join(harnessDir, 'pending-tasks.json')
  if (existsSync(pendingFile)) {
    try {
      const tasks = JSON.parse(readFileSync(pendingFile, 'utf-8'))
      if (tasks.length > 0) {
        return { 
          shouldContinue: true, 
          message: `${tasks.length} pending tasks`,
          tasks: tasks.slice(0, 3) // Show first 3
        }
      }
    } catch {}
  }

  // Check for continuation prompt
  const continuationFile = join(harnessDir, 'continuation_prompt.md')
  if (existsSync(continuationFile)) {
    return { 
      shouldContinue: true, 
      message: 'Continuation prompt exists' 
    }
  }

  return { shouldContinue: false, message: 'No continuation needed' }
}

// CLI mode
if (process.argv[1]?.endsWith('continuation.mjs')) {
  let projectDir = process.argv[2] || process.cwd()
  try {
    const raw = readFileSync(0, 'utf-8')
    if (raw.trim()) {
      const input = JSON.parse(raw)
      projectDir = input.projectDir || input.cwd || projectDir
    }
  } catch {}
  continuation(projectDir)
  process.exit(0)
}
