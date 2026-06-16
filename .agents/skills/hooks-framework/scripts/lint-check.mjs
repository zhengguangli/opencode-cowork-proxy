#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs'
import { extname } from 'path'
import { parseStdin } from './lib/harness-utils.mjs'

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

    if (filePath.includes('/translate/') || filePath.includes('\\translate\\')) {
      const translateForbidden = [
        { pattern: /import.*from\s+['"].*\/handlers\//, message: 'translate/ must not import from handlers/' },
        { pattern: /import.*from\s+['"].*\/providers/, message: 'translate/ must not import from providers' },
        { pattern: /import.*from\s+['"].*\/routing/, message: 'translate/ must not import from routing' },
        { pattern: /import.*from\s+['"].*\/request/, message: 'translate/ must not import from request' },
        { pattern: /fetch\(/, message: 'translate/ must not use fetch (purity violation)' },
        { pattern: /fs\./, message: 'translate/ must not use fs (purity violation)' },
      ]
      for (const { pattern, message } of translateForbidden) {
        if (pattern.test(content)) {
          violations.push(message)
        }
      }
    }

    if (filePath.includes('/handlers/') || filePath.includes('\\handlers\\')) {
      if (/import.*from\s+['"].*format.*translation|import.*from\s+['"].*format-translation/.test(content)) {
        if (!/import.*from\s+['"].*\/translate\//.test(content)) {
          violations.push('handlers/ must use translate/ for format conversion')
        }
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

if (process.argv[1]?.endsWith('lint-check.mjs')) {
  const input = await parseStdin()
  const filePath = input.filePath
    || input.tool_input?.file_path
    || input.file_path
    || input.path
    || ''
  const result = lintCheck(filePath, input.projectDir || input.cwd || process.cwd())
  if (!result.valid && result.violations && result.violations.length > 0) {
    console.log(result.message)
  }
  process.exit(result.valid ? 0 : 1)
}
