import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

export function envVerify(projectDir) {
  const warnings = []

  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    if (!existsSync(join(projectDir, file))) {
      warnings.push(`缺少 ${file}`)
    }
  }

  const claudeDir = join(projectDir, '.claude')
  if (existsSync(claudeDir)) {
    const agentsDir = join(claudeDir, 'agents')
    const skillsDir = join(claudeDir, 'skills')
    const agentCount = existsSync(agentsDir) ? readdirSync(agentsDir).filter(f => f.endsWith('.md')).length : 0
    const skillCount = existsSync(skillsDir) ? readdirSync(skillsDir, { recursive: true }).filter(f => f === 'SKILL.md').length : 0
    console.error(`[env-verify] Agents: ${agentCount}, Skills: ${skillCount}`)
  } else {
    warnings.push('.claude/ 目录不存在 — harness 未安装')
  }

  if (warnings.length > 0) console.error(`[env-verify] ${warnings.length} 个警告`)
  return { exitCode: 0, message: '' }
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
