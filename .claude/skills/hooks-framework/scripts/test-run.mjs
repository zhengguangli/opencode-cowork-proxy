import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

function detectTestCommand(projectDir) {
  if (existsSync(join(projectDir, 'package.json'))) {
    try {
      const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'))
      if (pkg.scripts?.test) return 'npm test'
    } catch {}
  }
  if (existsSync(join(projectDir, 'Cargo.toml'))) return 'cargo test'
  if (existsSync(join(projectDir, 'go.mod'))) return 'go test ./...'
  if (existsSync(join(projectDir, 'Makefile'))) {
    try {
      const mk = readFileSync(join(projectDir, 'Makefile'), 'utf-8')
      if (/^test:/m.test(mk)) return 'make test'
    } catch {}
  }
  return null
}

export function testRun(projectDir) {
  const cmd = detectTestCommand(projectDir)
  if (!cmd) return { exitCode: 0, message: '[test-run] 未检测到测试命令 — 跳过' }

  console.error(`[test-run] 执行: ${cmd}`)
  try {
    const output = execSync(cmd, { cwd: projectDir, timeout: 120000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    return { exitCode: 0, message: '[test-run] 测试通过' }
  } catch (e) {
    const tail = e.stderr?.split('\n').slice(-20).join('\n') || e.message
    return { exitCode: 1, message: `[test-run] 测试失败\n${tail}` }
  }
}

if (process.argv[1]?.endsWith('test-run.mjs')) {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd()
  const r = testRun(dir)
  if (r.message) console.log(r.message)
  process.exit(r.exitCode)
}
