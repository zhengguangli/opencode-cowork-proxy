import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

export function contextCheck(projectDir) {
  const agentsFile = join(projectDir, 'AGENTS.md')
  const errors = []

  if (!existsSync(agentsFile)) {
    errors.push('缺少 AGENTS.md — 智能体无法推理项目结构')
    return { exitCode: 1, message: errors.join('\n') }
  }

  const content = readFileSync(agentsFile, 'utf-8')
  const lines = content.split('\n').length

  if (lines > 150) {
    errors.push(`AGENTS.md 超限: ${lines} 行（上限 150）— 挤占上下文空间`)
  } else if (lines > 100) {
    console.error(`[context-check] AGENTS.md 接近上限: ${lines} 行（建议 ≤100）`)
  }

  const stat = statSync(agentsFile)
  const ageDays = Math.floor((Date.now() - stat.mtimeMs) / 86400000)
  if (ageDays > 30) {
    console.error(`[context-check] AGENTS.md 已过期: ${ageDays} 天未更新`)
  }

  for (const section of ['项目概述', '架构地图', '关键约束']) {
    if (!content.includes(section)) {
      errors.push(`AGENTS.md 缺少 section: ${section}`)
    }
  }

  if (errors.length > 0) {
    return { exitCode: 1, message: errors.join('\n') }
  }
  return { exitCode: 0, message: `[context-check] AGENTS.md 健康 (${lines} 行)` }
}

if (process.argv[1]?.endsWith('context-check.mjs')) {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd()
  const r = contextCheck(dir)
  if (r.message) {
    if (r.exitCode !== 0) console.error(r.message)
    else console.log(r.message)
  }
  process.exit(0)
}
