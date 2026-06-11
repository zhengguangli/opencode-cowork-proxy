#!/usr/bin/env node
/**
 * context-check.mjs — AGENTS.md Freshness Check
 * Checks if AGENTS.md exists and is recent enough
 */

import { statSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'

const MAX_AGE_DAYS = 30

function findProjectRoot(startDir) {
  let dir = startDir
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'AGENTS.md')) || existsSync(join(dir, '.codex', 'hooks.json'))) {
      return dir
    }
    dir = dirname(dir)
  }
  return startDir
}

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

// CLI mode
if (process.argv[1]?.endsWith('context-check.mjs')) {
  let projectDir = process.argv[2] || process.cwd()
  // Try reading stdin for Claude Code / Codex hook context (has cwd field)
  try {
    const raw = readFileSync(0, 'utf-8')
    if (raw.trim()) {
      const input = JSON.parse(raw)
      projectDir = input.cwd || input.projectDir || projectDir
    }
  } catch {}
  // Find project root if not already there
  projectDir = findProjectRoot(projectDir)
  const result = contextCheck(projectDir)
  // Only output on failure; success = silent (exit 0)
  if (!result.valid) {
    console.log(result.message)
  }
  process.exit(result.valid ? 0 : 1)
}
