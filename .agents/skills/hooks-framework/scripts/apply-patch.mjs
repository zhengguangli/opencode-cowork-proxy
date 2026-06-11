#!/usr/bin/env node
/**
 * apply-patch.mjs — Patch Validation & Application
 * Validates unified diff format and applies patches
 */

import { readFileSync } from 'fs'

export function applyPatch(patchContent, projectDir) {
  if (!patchContent) {
    return { valid: false, message: 'No patch content provided' }
  }

  // Basic unified diff validation
  const lines = patchContent.split('\n')
  const hunkHeaderPattern = /^@@ -\d+,?\d* \+\d+,?\d* @@/
  
  let hasHunkHeader = false
  let hasChanges = false
  let invalidLine = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (hunkHeaderPattern.test(line)) {
      hasHunkHeader = true
    }
    if (hasHunkHeader && (line.startsWith('+') || line.startsWith('-'))) {
      hasChanges = true
    }
    // Check for invalid lines (not starting with +, -, space, @, or being empty)
    if (hasHunkHeader && line.length > 0 && 
        !line.startsWith('+') && !line.startsWith('-') && 
        !line.startsWith(' ') && !line.startsWith('@') &&
        !line.startsWith('\\')) {
      invalidLine = i + 1
      break
    }
  }

  if (!hasHunkHeader) {
    return { valid: false, message: 'Missing hunk header (@@ -line,count +line,count @@)' }
  }

  if (!hasChanges) {
    return { valid: false, message: 'No changes found in patch' }
  }

  if (invalidLine > 0) {
    return { valid: false, message: `Invalid patch format at line ${invalidLine}` }
  }

  return { 
    valid: true, 
    message: 'Patch format valid',
    stats: {
      lines: lines.length,
      hunks: lines.filter(l => hunkHeaderPattern.test(l)).length
    }
  }
}

// CLI mode
if (process.argv[1]?.endsWith('apply-patch.mjs')) {
  let input = {}
  try { const raw = readFileSync(0, 'utf-8'); if (raw.trim()) input = JSON.parse(raw) } catch {}
  const result = applyPatch(input.patch || input.toolOutput || input.tool_output, input.projectDir || input.cwd || process.cwd())
  if (!result.valid) console.log(result.error || 'Invalid patch')
  process.exit(result.valid ? 0 : 1)
}
