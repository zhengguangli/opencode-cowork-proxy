#!/usr/bin/env node
/**
 * tool-offload.mjs — Tool Output Offloading
 * When tool output exceeds threshold, save to filesystem
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

const DEFAULT_THRESHOLD = 2000

export function toolOffload(toolOutput, toolName, projectDir, threshold = DEFAULT_THRESHOLD) {
  if (!toolOutput || toolOutput.length <= threshold) {
    return { offloaded: false, message: 'Output within threshold' }
  }

  const offloadDir = join(projectDir, '.harness-polit', 'offloaded')
  if (!existsSync(offloadDir)) {
    mkdirSync(offloadDir, { recursive: true })
  }

  const timestamp = Date.now()
  const filename = `${toolName || 'output'}_${timestamp}.txt`
  const filepath = join(offloadDir, filename)

  writeFileSync(filepath, toolOutput, 'utf-8')

  const lines = toolOutput.split('\n')
  const head = lines.slice(0, 20).join('\n')
  const tail = lines.slice(-10).join('\n')

  return {
    offloaded: true,
    message: `Output offloaded to ${filename}`,
    reference: {
      file: `.harness-polit/offloaded/${filename}`,
      head,
      tail,
      totalLines: lines.length,
    },
  }
}

// CLI mode
if (process.argv[1]?.endsWith('tool-offload.mjs')) {
  let input = {}
  try { const raw = readFileSync(0, 'utf-8'); if (raw.trim()) input = JSON.parse(raw) } catch {}
  toolOffload(
    input.tool_output || input.toolOutput || '',
    input.tool_name || input.toolName || 'unknown',
    input.projectDir || input.cwd || process.cwd()
  )
  // Silent on success; Codex treats exit 0 with no output as success
  process.exit(0)
}
