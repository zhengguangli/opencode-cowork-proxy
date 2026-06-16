import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, dirname, extname } from 'path'

export function getWorkspaceDir(projectDir) {
  if (process.env.HARNESS_WORKSPACE) return process.env.HARNESS_WORKSPACE
  const root = projectDir
    || process.env.CLAUDE_PROJECT_DIR
    || process.env.CODEX_PROJECT_DIR
    || process.env.OPENCODE_PROJECT_DIR
    || process.env.PROJECT_DIR
    || process.cwd()
  return join(root, '.harness-pilot')
}

export function findProjectRoot(startDir) {
  let dir = startDir
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'AGENTS.md')) || existsSync(join(dir, '.codex', 'hooks.json'))) {
      return dir
    }
    dir = dirname(dir)
  }
  return startDir
}

export function findFiles(dir, exts, maxDepth = 10) {
  const results = []
  const SKIP = new Set(['node_modules', '.git', 'target', 'dist', 'build', '.next', '.workspace', '.harness-pilot'])
  function walk(d, depth) {
    if (depth > maxDepth) return
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else if (exts.has(extname(e.name))) results.push(full)
    }
  }
  walk(dir, 0)
  return results
}

export async function parseStdin() {
  try {
    const raw = readFileSync(0, 'utf-8')
    if (raw.trim()) return JSON.parse(raw)
  } catch {}
  return {}
}

export function getProjectDir(input) {
  return input.projectDir || input.cwd || process.cwd()
}
