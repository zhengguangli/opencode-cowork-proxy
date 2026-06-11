#!/usr/bin/env node
/**
 * env-verify.mjs — Environment Readiness Check
 * Verifies Node.js version and required tools
 */

import { execSync } from 'child_process'
import { readFileSync } from 'fs'

export function envVerify(projectDir) {
  const checks = []

  // Check Node.js version
  try {
    const nodeVersion = process.version
    const major = parseInt(nodeVersion.slice(1).split('.')[0])
    checks.push({ 
      name: 'node', 
      valid: major >= 18, 
      message: `Node.js ${nodeVersion}` 
    })
  } catch {
    checks.push({ name: 'node', valid: false, message: 'Node.js not found' })
  }

  // Check git
  try {
    execSync('git --version', { encoding: 'utf-8' })
    checks.push({ name: 'git', valid: true, message: 'Git available' })
  } catch {
    checks.push({ name: 'git', valid: false, message: 'Git not found' })
  }

  const failures = checks.filter(c => !c.valid)
  return {
    valid: failures.length === 0,
    message: failures.length === 0 
      ? 'Environment ready' 
      : `Missing: ${failures.map(f => f.name).join(', ')}`,
    checks
  }
}

// CLI mode
if (process.argv[1]?.endsWith('env-verify.mjs')) {
  let projectDir = process.argv[2] || process.cwd()
  try {
    const raw = readFileSync(0, 'utf-8')
    if (raw.trim()) {
      const input = JSON.parse(raw)
      projectDir = input.cwd || input.projectDir || projectDir
    }
  } catch {}
  const result = envVerify(projectDir)
  // Only output on failure; success = silent (exit 0)
  if (!result.valid) {
    console.log(result.message)
  }
  process.exit(result.valid ? 0 : 1)
}
