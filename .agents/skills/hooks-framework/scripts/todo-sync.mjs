#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { parseStdin } from './lib/harness-utils.mjs'

export function todoSync(projectDir, todoData) {
  const harnessDir = join(projectDir, '.harness-pilot')
  if (!existsSync(harnessDir)) {
    mkdirSync(harnessDir, { recursive: true })
  }

  const todoPath = join(harnessDir, 'todo-state.json')
  
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

if (process.argv[1]?.endsWith('todo-sync.mjs')) {
  let projectDir = process.argv[2] || process.cwd()
  let todoData = null
  const input = await parseStdin()
  projectDir = input.projectDir || input.cwd || projectDir
  todoData = input.todoData
  todoSync(projectDir, todoData)
  process.exit(0)
}
