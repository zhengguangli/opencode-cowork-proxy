import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { platform } from 'os'

function checkCommand(cmd) {
  try {
    const isWindows = platform() === 'win32'
    const checkCmd = isWindows ? `where ${cmd}` : `which ${cmd}`
    execSync(checkCmd, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function detectTestCommand(projectDir) {
  if (existsSync(join(projectDir, 'package.json'))) {
    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'))
    if (pkg.scripts?.test) return { cmd: 'npm test', framework: 'npm' }
    if (pkg.devDependencies?.vitest || pkg.dependencies?.vitest) return { cmd: 'npx vitest run', framework: 'vitest' }
    if (pkg.devDependencies?.jest || pkg.dependencies?.jest) return { cmd: 'npx jest', framework: 'jest' }
  }

  if (existsSync(join(projectDir, 'Cargo.toml'))) return { cmd: 'cargo test', framework: 'cargo' }
  if (existsSync(join(projectDir, 'go.mod'))) return { cmd: 'go test ./...', framework: 'go' }
  if (existsSync(join(projectDir, 'pyproject.toml'))) {
    if (existsSync(join(projectDir, 'pytest.ini')) || existsSync(join(projectDir, 'tests'))) {
      return { cmd: 'pytest', framework: 'pytest' }
    }
    return { cmd: 'python -m pytest', framework: 'pytest' }
  }

  return null
}

export function testRun(projectDir) {
  const testConfig = detectTestCommand(projectDir)

  if (!testConfig) {
    return {
      exitCode: 0,
      message: '[test-run] 未检测到测试框架，跳过测试'
    }
  }

  const { cmd, framework } = testConfig
  console.error(`[test-run] 运行测试: ${cmd} (${framework})`)

  try {
    const output = execSync(cmd, {
      cwd: projectDir,
      encoding: 'utf-8',
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    return {
      exitCode: 0,
      message: `[test-run] 测试通过 (${framework})\n${output.slice(-500)}`
    }
  } catch (err) {
    const output = err.stdout || err.stderr || err.message
    return {
      exitCode: 1,
      message: `[test-run] 测试失败 (${framework})\n${output.slice(-500)}`
    }
  }
}

if (process.argv[1]?.endsWith('test-run.mjs')) {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd()
  const r = testRun(dir)
  if (r.message) {
    if (r.exitCode !== 0) console.error(r.message)
    else console.log(r.message)
  }
  process.exit(0)
}
