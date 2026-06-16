#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { findProjectRoot, parseStdin } from './lib/harness-utils.mjs'

const DEFAULT_TTL_MS = 300000
const OFFLOAD_MAX_AGE_MS = 3600000

export function contextCleanup(projectDir, filePath, ttlMs = DEFAULT_TTL_MS) {
  const harnessDir = join(projectDir, '.harness-pilot')
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

  if (filePath) {
    refs[filePath] = {
      lastAccessed: Date.now(),
      accessCount: (refs[filePath]?.accessCount || 0) + 1
    }
  }

  const now = Date.now()
  const offloadable = Object.entries(refs)
    .filter(([_, ref]) => now - ref.lastAccessed > ttlMs)
    .map(([path]) => path)

  for (const path of offloadable) {
    delete refs[path]
  }

  writeFileSync(refsFile, JSON.stringify(refs, null, 2), 'utf-8')

  const unloadableFile = join(harnessDir, 'unloadable-files.json')
  writeFileSync(unloadableFile, JSON.stringify(offloadable, null, 2), 'utf-8')

  const offloadDir = join(harnessDir, 'offloaded')
  if (existsSync(offloadDir)) {
    try {
      const entries = readdirSync(offloadDir)
      for (const entry of entries) {
        const fullPath = join(offloadDir, entry)
        try {
          const fileStat = statSync(fullPath)
          if (now - fileStat.mtimeMs > OFFLOAD_MAX_AGE_MS) {
            unlinkSync(fullPath)
          }
        } catch {}
      }
    } catch {}
  }

  return {
    success: true,
    message: offloadable.length > 0 
      ? `${offloadable.length} files offloadable` 
      : 'No files to offload',
    offloadable,
    trackedFiles: Object.keys(refs).length
  }
}

if (process.argv[1]?.endsWith('context-cleanup.mjs')) {
  const args = process.argv.slice(2)

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

  const input = await parseStdin()
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
  process.exit(0)
}
