import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { join, extname } from 'path'
import { execSync } from 'child_process'

function findSourceFiles(projectDir, exts) {
  const results = []
  const skip = new Set(['node_modules', '.git', 'target', 'dist', 'build', '.next'])
  function walk(dir, depth) {
    if (depth > 5) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (skip.has(e.name)) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else if (exts.has(extname(e.name))) results.push(full)
    }
  }
  walk(projectDir, 0)
  return results
}

export function qualityMetric(projectDir) {
  const ws = join(projectDir, '.workspace')
  const metricsDir = join(ws, 'metrics')
  try { mkdirSync(metricsDir, { recursive: true }) } catch {}

  const dateStr = new Date().toISOString().slice(0, 10)
  const exts = new Set(['.ts', '.js', '.py', '.go', '.rs', '.tsx', '.jsx'])
  const files = findSourceFiles(projectDir, exts)

  let todoCount = 0
  let largeFiles = 0
  let totalLines = 0

  for (const f of files) {
    try {
      const content = readFileSync(f, 'utf-8')
      const lines = content.split('\n')
      totalLines += lines.length
      if (lines.length > 500) largeFiles++
      for (const line of lines) {
        if (/TODO|FIXME/.test(line)) todoCount++
      }
    } catch {}
  }

  let commitCount = 0
  try {
    commitCount = parseInt(execSync('git log --oneline -30 2>/dev/null | wc -l', { cwd: projectDir, encoding: 'utf-8', timeout: 5000 }).trim())
  } catch {}

  const avgLines = files.length > 0 ? Math.round(totalLines / files.length) : 0

  const metrics = {
    timestamp: new Date().toISOString(),
    metrics: { todo_count: todoCount, file_count: files.length, avg_lines_per_file: avgLines, large_files: largeFiles, recent_commits: commitCount }
  }

  writeFileSync(join(metricsDir, `quality_${dateStr}.json`), JSON.stringify(metrics, null, 2))
  return { exitCode: 0, message: '' }
}

if (process.argv[1]?.endsWith('quality-metric.mjs')) {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd()
  const r = qualityMetric(dir)
  if (r.message) console.log(r.message)
  process.exit(0)
}
