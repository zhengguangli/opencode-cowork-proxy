#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { parseStdin } from './lib/harness-utils.mjs'

export function applyPatch(patchContent, projectDir) {
  if (!patchContent) {
    return { valid: false, message: 'No patch content provided' }
  }

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

  const validationResult = { 
    valid: true, 
    message: 'Patch format valid',
    stats: {
      lines: lines.length,
      hunks: lines.filter(l => hunkHeaderPattern.test(l)).length
    }
  }

  let targetFile = null
  for (const line of lines) {
    if (line.startsWith('--- a/')) {
      targetFile = line.slice(6)
      break
    }
  }
  if (!targetFile) {
    return { ...validationResult, applied: false, message: 'Patch format valid but no target file found for application' }
  }

  const targetPath = join(projectDir, targetFile)
  let originalContent = ''
  if (existsSync(targetPath)) {
    try {
      originalContent = readFileSync(targetPath, 'utf-8')
    } catch {
      return { ...validationResult, applied: false, message: `Cannot read target file: ${targetFile}` }
    }
  }

  const originalLines = originalContent.split('\n')
  const resultLines = [...originalLines]
  let offset = 0

  let currentLine = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const hunkMatch = line.match(/^@@ -(\d+),?\d* \+(\d+),?\d* @@/)
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[2]) - 1
      continue
    }

    if (line.startsWith('@@') || !hunkHeaderPattern.test(lines.slice(0, i + 1).some(l => hunkHeaderPattern.test(l)) ? 'x' : '')) {
      if (!hunkHeaderPattern.test(line) && !line.startsWith('\\')) {
        continue
      }
    }

    if (line.startsWith('-')) {
      const removeContent = line.slice(1)
      const targetIdx = currentLine + offset
      if (targetIdx < resultLines.length && resultLines[targetIdx] === removeContent) {
        resultLines.splice(targetIdx, 1)
        offset--
      } else {
        let found = false
        for (let search = Math.max(0, targetIdx - 3); search < Math.min(resultLines.length, targetIdx + 3); search++) {
          if (resultLines[search] === removeContent) {
            resultLines.splice(search, 1)
            offset--
            currentLine = search
            found = true
            break
          }
        }
        if (!found) {
          return { ...validationResult, applied: false, message: `Cannot find context line to remove: ${removeContent}` }
        }
      }
      continue
    }

    if (line.startsWith('+')) {
      const addContent = line.slice(1)
      const insertIdx = currentLine + offset
      resultLines.splice(insertIdx, 0, addContent)
      offset++
      currentLine++
      continue
    }

    if (line.startsWith(' ') || line === '') {
      currentLine++
      continue
    }
  }

  const patchedContent = resultLines.join('\n')

  const patchesDir = join(projectDir, '.harness-pilot', 'patches')
  if (!existsSync(patchesDir)) {
    mkdirSync(patchesDir, { recursive: true })
  }

  const patchRecord = {
    targetFile,
    timestamp: new Date().toISOString(),
    originalContent,
    patchedContent,
  }
  const patchRecordPath = join(patchesDir, `${targetFile.replace(/[\/\\]/g, '_')}_${Date.now()}.json`)
  writeFileSync(patchRecordPath, JSON.stringify(patchRecord, null, 2), 'utf-8')

  writeFileSync(targetPath, patchedContent, 'utf-8')

  return { 
    ...validationResult,
    applied: true,
    message: `Patch applied to ${targetFile}`,
    targetFile,
    patchRecord: patchRecordPath
  }
}

if (process.argv[1]?.endsWith('apply-patch.mjs')) {
  const input = await parseStdin()
  const result = applyPatch(input.patch || input.toolOutput || input.tool_output, input.projectDir || input.cwd || process.cwd())
  if (!result.valid) console.log(result.message || 'Invalid patch')
  process.exit(result.valid ? 0 : 1)
}
