import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'

export function continuation(projectDir) {
  const ws = join(projectDir, '.workspace')
  if (!existsSync(ws)) return { exitCode: 0, message: '' }

  let interrupted = false
  let reason = ''

  const flagFile = join(ws, 'interrupted.flag')
  if (existsSync(flagFile)) {
    interrupted = true
    reason = readFileSync(flagFile, 'utf-8').trim()
  }

  const taskFile = join(ws, 'current_task.md')
  if (existsSync(taskFile)) {
    const content = readFileSync(taskFile, 'utf-8')
    if (/incomplete|未完成|interrupted|中断/i.test(content)) {
      interrupted = true
      reason = reason || '任务标记为未完成'
    }
  }

  try {
    const entries = readdirSync(ws).filter(f => f.startsWith('progress_') && f.endsWith('.md'))
    for (const f of entries) {
      const stat = statSync(join(ws, f))
      if (Date.now() - stat.mtimeMs < 1800000) {
        interrupted = true
        reason = reason || `发现最近的进度文件: ${f}`
        break
      }
    }
  } catch {}

  if (!interrupted) return { exitCode: 0, message: '' }

  const currentTask = existsSync(taskFile) ? readFileSync(taskFile, 'utf-8') : '无任务记录'
  const progressFiles = readdirSync(ws).filter(f => f.startsWith('progress_') && f.endsWith('.md')).slice(0, 3)
  const progressList = progressFiles.map(f => `- ${f}`).join('\n') || '无'

  const prompt = `# 续行提示 (Ralph Loop)\n\n**检测到中断:** ${reason}\n\n## 原始任务\n\n${currentTask}\n\n## 已完成进度\n\n${progressList}\n\n## 续行指令\n\n1. 读取上述进度文件了解已完成的工作\n2. 从上次中断点继续执行\n3. 完成后更新 .workspace/current_task.md 的状态\n`

  try { mkdirSync(join(ws, 'tool_output'), { recursive: true }) } catch {}
  writeFileSync(join(ws, 'continuation_prompt.md'), prompt)
  try { unlinkSync(flagFile) } catch {}

  return { exitCode: 0, message: `[continuation] 已生成续行提示: ${reason}` }
}

if (process.argv[1]?.endsWith('continuation.mjs')) {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd()
  const r = continuation(dir)
  if (r.message) console.error(r.message)
  process.exit(0)
}
