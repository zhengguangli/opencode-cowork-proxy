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

function getPackageManager(projectDir) {
  if (existsSync(join(projectDir, 'package-lock.json'))) return 'npm'
  if (existsSync(join(projectDir, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(projectDir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(projectDir, 'bun.lockb'))) return 'bun'
  return null
}

export function envVerify(projectDir) {
  const issues = []
  const info = []

  // 检查 Node.js
  if (checkCommand('node')) {
    try {
      const version = execSync('node --version', { encoding: 'utf-8' }).trim()
      info.push(`Node.js: ${version}`)
    } catch {
      issues.push('Node.js 已安装但无法获取版本')
    }
  } else {
    issues.push('缺少 Node.js — 多数脚本需要运行时')
  }

  // 检查 Git
  if (checkCommand('git')) {
    try {
      const version = execSync('git --version', { encoding: 'utf-8' }).trim()
      info.push(`Git: ${version}`)
    } catch {
      issues.push('Git 已安装但无法获取版本')
    }
  } else {
    issues.push('缺少 Git — 版本控制必需')
  }

  // 检查包管理器
  const pm = getPackageManager(projectDir)
  if (pm) {
    info.push(`包管理器: ${pm}`)
    if (!checkCommand(pm)) {
      issues.push(`检测到 ${pm} 锁文件但未安装 ${pm}`)
    }
  }

  // 检查项目关键文件
  const criticalFiles = ['AGENTS.md', 'CLAUDE.md']
  for (const file of criticalFiles) {
    if (!existsSync(join(projectDir, file))) {
      issues.push(`缺少 ${file} — 智能体无法推理项目结构`)
    }
  }

  // 检查 docs/ 目录
  if (!existsSync(join(projectDir, 'docs'))) {
    issues.push('缺少 docs/ 目录 — 知识库未初始化')
  }

  // 检查 .claude/ 目录
  if (!existsSync(join(projectDir, '.claude'))) {
    issues.push('缺少 .claude/ 目录 — harness 未安装')
  }

  const exitCode = issues.length > 0 ? 1 : 0
  const message = [
    issues.length > 0 ? `[env-verify] 发现 ${issues.length} 个问题:` : '[env-verify] 环境就绪',
    ...issues.map(i => `  - ${i}`),
    info.length > 0 ? `\n环境信息:\n${info.map(i => `  ${i}`).join('\n')}` : ''
  ].filter(Boolean).join('\n')

  return { exitCode, message }
}

if (process.argv[1]?.endsWith('env-verify.mjs')) {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd()
  const r = envVerify(dir)
  if (r.message) {
    if (r.exitCode !== 0) console.error(r.message)
    else console.log(r.message)
  }
  process.exit(0)
}
