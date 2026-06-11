#!/usr/bin/env node
/**
 * lint-check.mjs — Architecture Boundary Check
 * Validates file edits against architecture rules
 */

import { readFileSync, existsSync } from 'fs'
import { extname } from 'path'

const FORBIDDEN_PATTERNS = [
  { pattern: /import.*from\s+['"]\.\.\/\.\.\/\.\.\//, message: 'Too deep relative import' },
  { pattern: /require\(/, message: 'Use ES modules, not CommonJS' },
]

export function lintCheck(filePath, projectDir) {
  if (!filePath || !existsSync(filePath)) {
    return { valid: true, message: 'No file to check' }
  }

  const ext = extname(filePath)
  if (!['.js', '.ts', '.mjs', '.mts'].includes(ext)) {
    return { valid: true, message: 'Not a JS/TS file' }
  }

  try {
    const content = readFileSync(filePath, 'utf-8')
    const violations = []

    for (const { pattern, message } of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        violations.push(message)
      }
    }

    return {
      valid: violations.length === 0,
      message: violations.length === 0 
        ? 'Lint passed' 
        : `Violations: ${violations.join(', ')}`,
      violations
    }
  } catch (err) {
    return { valid: true, message: 'Could not read file' }
  }
}

// CLI mode
if (process.argv[1]?.endsWith('lint-check.mjs')) {
  let input = {}
  try { const raw = readFileSync(0, 'utf-8'); if (raw.trim()) input = JSON.parse(raw) } catch {}
  const filePath = input.filePath
    || input.tool_input?.file_path
    || input.file_path
    || input.path
    || ''
  const result = lintCheck(filePath, input.projectDir || input.cwd || process.cwd())
  // Only output on failure with violations; success = silent (exit 0)
  if (!result.valid && result.violations && result.violations.length > 0) {
    console.log(result.message)
  }
  process.exit(result.valid ? 0 : 1)
}
