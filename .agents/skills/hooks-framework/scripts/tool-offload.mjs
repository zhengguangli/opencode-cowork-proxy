#!/usr/bin/env node

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from 'fs'
import { join } from 'path'
import { parseStdin } from './lib/harness-utils.mjs'

const DEFAULT_THRESHOLD = 2000
const OFFLOAD_TTL_MS = 86400000

export function toolOffload(toolOutput, toolName, projectDir, threshold = DEFAULT_THRESHOLD) {
  if (!toolOutput || toolOutput.length <= threshold) {
    return { offloaded: false, message: 'Output within threshold' }
  }

  const offloadDir = join(projectDir, '.harness-pilot', 'offloaded')
  if (!existsSync(offloadDir)) {
    mkdirSync(offloadDir, { recursive: true })
  }

  const timestamp = Date.now()
  const filename = `${toolName || 'output'}_${timestamp}.txt`
  const filepath = join(offloadDir, filename)

  writeFileSync(filepath, toolOutput, 'utf-8')

  const now = Date.now()
  try {
    const entries = readdirSync(offloadDir)
    for (const entry of entries) {
      const fullPath = join(offloadDir, entry)
      try {
        const fileStat = statSync(fullPath)
        if (now - fileStat.mtimeMs > OFFLOAD_TTL_MS) {
          unlinkSync(fullPath)
        }
      } catch {}
    }
  } catch {}

  const lines = toolOutput.split('\n')
  const head = lines.slice(0, 20).join('\n')
  const tail = lines.slice(-10).join('\n')

  return {
    offloaded: true,
    message: `Output offloaded to ${filename}`,
    reference: {
      file: `.harness-pilot/offloaded/${filename}`,
      head,
      tail,
      totalLines: lines.length,
    },
  }
}

if (process.argv[1]?.endsWith('tool-offload.mjs')) {
  const input = await parseStdin()
  toolOffload(
    input.tool_output || input.toolOutput || '',
    input.tool_name || input.toolName || 'unknown',
    input.projectDir || input.cwd || process.cwd()
  )
  process.exit(0)
}
