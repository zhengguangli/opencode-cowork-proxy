#!/usr/bin/env node

import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { parseStdin } from './lib/harness-utils.mjs'

export function testRun(projectDir, testCommand) {
  if (!testCommand) {
    try {
      execSync('bun --version', { encoding: 'utf-8', stdio: 'pipe' })
      testCommand = 'bun test'
    } catch {}
  }

  if (!testCommand) {
    const pkgPath = join(projectDir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
        testCommand = pkg.scripts?.test
      } catch {}
    }
  }

  if (!testCommand) {
    testCommand = 'npm test'
  }

  try {
    const output = execSync(testCommand, { 
      cwd: projectDir,
      encoding: 'utf-8',
      timeout: 120000
    })
    
    return { 
      success: true, 
      message: 'Tests passed',
      output: output.slice(0, 500)
    }
  } catch (err) {
    return { 
      success: false, 
      message: 'Tests failed',
      error: err.message.slice(0, 500)
    }
  }
}

if (process.argv[1]?.endsWith('test-run.mjs')) {
  const input = await parseStdin()
  const result = testRun(input.projectDir || input.cwd || process.cwd(), input.testCommand)
  if (!result.success) console.log(result.error || result.message || 'Tests failed')
  process.exit(result.success ? 0 : 1)
}
