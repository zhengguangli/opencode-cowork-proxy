#!/usr/bin/env node

import { execSync } from 'child_process'
import { parseStdin } from './lib/harness-utils.mjs'

export function envVerify(projectDir) {
  const checks = []

  try {
    const bunVersion = execSync('bun --version', { encoding: 'utf-8' }).trim()
    checks.push({ 
      name: 'bun', 
      valid: true, 
      message: `Bun ${bunVersion}` 
    })
  } catch {
    checks.push({ name: 'bun', valid: false, message: 'Bun not found' })
  }

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

  try {
    let tscVersion
    try {
      tscVersion = execSync('bunx tsc --version', { encoding: 'utf-8' }).trim()
    } catch {
      tscVersion = execSync('tsc --version', { encoding: 'utf-8' }).trim()
    }
    checks.push({ name: 'typescript', valid: true, message: `TypeScript ${tscVersion}` })
  } catch {
    checks.push({ name: 'typescript', valid: false, message: 'TypeScript not found' })
  }

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

if (process.argv[1]?.endsWith('env-verify.mjs')) {
  let projectDir = process.argv[2] || process.cwd()
  const input = await parseStdin()
  projectDir = input.cwd || input.projectDir || projectDir
  const result = envVerify(projectDir)
  if (!result.valid) {
    console.log(result.message)
  }
  process.exit(result.valid ? 0 : 1)
}
