#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { parseStdin, getProjectDir } from './lib/harness-utils.mjs'

export function continuation(projectDir) {
  const harnessDir = join(projectDir, '.harness-pilot')
  
  const pendingFile = join(harnessDir, 'todo-state.json')
  if (existsSync(pendingFile)) {
    try {
      const todoData = JSON.parse(readFileSync(pendingFile, 'utf-8'))
      const tasks = (todoData.todos || []).filter(t => t.status === 'pending' || t.status === 'in_progress')
      if (tasks.length > 0) {
        return { 
          shouldContinue: true, 
          message: `${tasks.length} pending tasks`,
          tasks: tasks.slice(0, 3)
        }
      }
    } catch {}
  }

  const continuationFile = join(harnessDir, 'continuation_prompt.md')
  if (existsSync(continuationFile)) {
    return { 
      shouldContinue: true, 
      message: 'Continuation prompt exists' 
    }
  }

  return { shouldContinue: false, message: 'No continuation needed' }
}

if (process.argv[1]?.endsWith('continuation.mjs')) {
  let projectDir = process.argv[2] || process.cwd()
  const input = await parseStdin()
  projectDir = input.projectDir || input.cwd || projectDir
  continuation(projectDir)
  process.exit(0)
}
