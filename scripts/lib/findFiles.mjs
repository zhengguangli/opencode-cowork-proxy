import { readdirSync } from 'fs'
import { join, extname } from 'path'

const DEFAULT_SKIP = new Set([
  'node_modules', '.git', 'target', 'dist', 'build',
  '.next', '.workspace', '_workspace', '.harness-pliot'
])

export function findFiles(dir, exts, { maxDepth = 10, skipDirs = [] } = {}) {
  const results = []
  const skip = new Set([...DEFAULT_SKIP, ...skipDirs])
  function walk(d, depth) {
    if (depth > maxDepth) return
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (skip.has(e.name)) continue
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else if (exts.has(extname(e.name))) results.push(full)
    }
  }
  walk(dir, 0)
  return results
}
