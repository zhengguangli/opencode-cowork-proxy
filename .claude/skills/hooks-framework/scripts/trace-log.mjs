import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, appendFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

export function traceLog(projectDir) {
  const ws = join(projectDir, '.workspace')
  const logDir = join(ws, 'trace')
  try { mkdirSync(logDir, { recursive: true }) } catch {}

  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const logFile = join(logDir, `trace_${dateStr}.log`)
  const ts = now.toISOString()

  let gitInfo = 'no-git'
  try {
    const branch = execSync('git branch --show-current', { cwd: projectDir, encoding: 'utf-8', timeout: 5000 }).trim()
    const commit = execSync('git rev-parse --short HEAD', { cwd: projectDir, encoding: 'utf-8', timeout: 5000 }).trim()
    const dirty = execSync('git diff --quiet && echo clean || echo dirty', { cwd: projectDir, encoding: 'utf-8', timeout: 5000 }).trim()
    gitInfo = `branch=${branch} commit=${commit} status=${dirty}`
  } catch {}

  const line = `${ts} [INFO] git: ${gitInfo}\n`
  appendFileSync(logFile, line)

  return { exitCode: 0, message: '' }
}

if (process.argv[1]?.endsWith('trace-log.mjs')) {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd()
  const r = traceLog(dir)
  if (r.message) console.log(r.message)
  process.exit(0)
}
