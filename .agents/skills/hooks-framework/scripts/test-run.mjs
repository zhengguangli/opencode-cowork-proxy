#!/usr/bin/env node
/**
 * test-run.mjs — Test Suite Execution
 * Runs project tests and reports results
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export function testRun(projectDir, testCommand) {
  // Try to detect test command from package.json
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
    return { 
      success: false, 
      message: 'No test command found',
      suggestion: 'Add test script to package.json'
    }
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
      output: output.slice(0, 500) // Truncate for context
    }
  } catch (err) {
    return { 
      success: false, 
      message: 'Tests failed',
      error: err.message.slice(0, 500)
    }
  }
}

// CLI mode
if (process.argv[1]?.endsWith('test-run.mjs')) {
  let input = {}
  try { const raw = readFileSync(0, 'utf-8'); if (raw.trim()) input = JSON.parse(raw) } catch {}
  const result = testRun(input.projectDir || input.cwd || process.cwd(), input.testCommand)
  if (!result.success) console.log(result.error || result.message || 'Tests failed')
  process.exit(result.success ? 0 : 1)
}
