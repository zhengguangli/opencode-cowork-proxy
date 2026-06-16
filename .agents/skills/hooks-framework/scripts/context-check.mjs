#!/usr/bin/env node

import { statSync, existsSync } from 'fs'
import { join } from 'path'
import { findProjectRoot, parseStdin, getProjectDir } from './lib/harness-utils.mjs'

const MAX_AGE_DAYS = parseInt(process.env.AGENTS_MAX_AGE_DAYS) || 30

export function contextCheck(projectDir) {
  const agentsPath = join(projectDir, 'AGENTS.md')
  
  if (!existsSync(agentsPath)) {
    return { valid: false, message: 'AGENTS.md not found' }
  }

  const stat = statSync(agentsPath)
  const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24)
  
  if (ageDays > MAX_AGE_DAYS) {
    return { 
      valid: false, 
      message: `AGENTS.md is ${Math.floor(ageDays)} days old (max: ${MAX_AGE_DAYS})` 
    }
  }

  return { valid: true, message: 'AGENTS.md is fresh' }
}

if (process.argv[1]?.endsWith('context-check.mjs')) {
  let projectDir = process.argv[2] || process.cwd()
  const input = await parseStdin()
  projectDir = input.cwd || input.projectDir || projectDir
  projectDir = findProjectRoot(projectDir)
  const result = contextCheck(projectDir)
  if (!result.valid) {
    console.log(result.message)
  }
  process.exit(result.valid ? 0 : 1)
}
