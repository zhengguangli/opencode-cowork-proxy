#!/usr/bin/env node
/**
 * context-cleanup.mjs — File Reference Tracking & Auto Offload
 * Tracks file references and identifies offloadable files
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

const DEFAULT_TTL_MS = 300000 // 5 minutes

function findProjectRoot(startDir) {
  let dir = startDir
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'AGENTS.md')) || existsSync(join(dir, '.codex', 'hooks.json'))) {
      return dir
    }
    dir = dirname(dir)
  }
  return startDir
}

export function contextCleanup(projectDir, filePath, ttlMs = DEFAULT_TTL_MS) {
  const harnessDir = join(projectDir, '.harness-pliot')
  if (!existsSync(harnessDir)) {
    mkdirSync(harnessDir, { recursive: true })
  }

  const refsFile = join(harnessDir, 'file-refs.json')
  let refs = {}

  if (existsSync(refsFile)) {
    try {
      refs = JSON.parse(readFileSync(refsFile, 'utf-8'))
    } catch {}
  }

  // Update reference
  if (filePath) {
    refs[filePath] = {
      lastAccessed: Date.now(),
      accessCount: (refs[filePath]?.accessCount || 0) + 1
    }
  }

  // Find offloadable files (unreferenced for > TTL)
  const now = Date.now()
  const offloadable = Object.entries(refs)
    .filter(([_, ref]) => now - ref.lastAccessed > ttlMs)
    .map(([path]) => path)

  // Save updated refs
  writeFileSync(refsFile, JSON.stringify(refs, null, 2), 'utf-8')

  // Save offloadable list
  const unloadableFile = join(harnessDir, 'unloadable-files.json')
  writeFileSync(unloadableFile, JSON.stringify(offloadable, null, 2), 'utf-8')

  return {
    success: true,
    message: offloadable.length > 0 
      ? `${offloadable.length} files offloadable` 
      : 'No files to offload',
    offloadable,
    trackedFiles: Object.keys(refs).length
  }
}

// CLI mode
if (process.argv[1]?.endsWith('context-cleanup.mjs')) {
  const args = process.argv.slice(2)

  // --seed: scan project for key files on SessionStart
  if (args.includes('--seed')) {
    const projectDir = args.find(a => a !== '--seed' && !a.startsWith('--')) || process.cwd()
    const seedPaths = [
      'package.json', 'tsconfig.json', 'AGENTS.md',
      'README.md', 'ARCHITECTURE.md',
    ]
    for (const p of seedPaths) {
      const fullPath = join(projectDir, p)
      if (existsSync(fullPath)) {
        contextCleanup(projectDir, fullPath)
      }
    }
    process.exit(0)
  }

  let input = {}
  try {
    const raw = readFileSync(0, 'utf-8')
    if (raw.trim()) input = JSON.parse(raw)
  } catch {}
  // Extract filePath from various hook stdin formats
  const filePath = input.filePath
    || input.input?.filePath
    || input.tool_input?.filePath
    || input.params?.filePath
    || input.path
    || input.file
    || ''
  contextCleanup(
    input.projectDir || process.cwd(),
    filePath,
    input.ttlMs
  )
  // Silent on success; Codex treats exit 0 with no output as success
  process.exit(0)
}
