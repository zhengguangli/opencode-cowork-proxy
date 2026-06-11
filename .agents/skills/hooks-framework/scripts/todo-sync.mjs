#!/usr/bin/env node
/**
 * todo-sync.mjs — Todo State Synchronization
 * Syncs todowrite state to filesystem for compaction
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export function todoSync(projectDir, todoData) {
  const harnessDir = join(projectDir, '.harness-pliot')
  if (!existsSync(harnessDir)) {
    mkdirSync(harnessDir, { recursive: true })
  }

  const todoPath = join(harnessDir, 'todo-state.json')
  
  // If todoData provided, save it
  if (todoData) {
    writeFileSync(todoPath, JSON.stringify({
      todos: todoData.todos || todoData,
      updatedAt: new Date().toISOString()
    }, null, 2), 'utf-8')
    
    return {
      success: true,
      message: 'Todo state saved',
      pending: (todoData.todos || todoData).filter(t => t.status === 'pending').length,
      inProgress: (todoData.todos || todoData).filter(t => t.status === 'in_progress').length
    }
  }

  // Otherwise, read existing state
  if (existsSync(todoPath)) {
    try {
      const state = JSON.parse(readFileSync(todoPath, 'utf-8'))
      return {
        success: true,
        message: 'Todo state loaded',
        todos: state.todos,
        updatedAt: state.updatedAt
      }
    } catch {
      return { success: false, message: 'Invalid todo state file' }
    }
  }

  return { success: true, message: 'No todo state found', todos: [] }
}

// CLI mode
if (process.argv[1]?.endsWith('todo-sync.mjs')) {
  let projectDir = process.argv[2] || process.cwd()
  let todoData = null
  try {
    const raw = readFileSync(0, 'utf-8')
    if (raw.trim()) {
      const input = JSON.parse(raw)
      projectDir = input.projectDir || input.cwd || projectDir
      todoData = input.todoData
    }
  } catch {}
  todoSync(projectDir, todoData)
  process.exit(0)
}
