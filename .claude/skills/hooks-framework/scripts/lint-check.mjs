import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { join, extname } from 'path'

function findFiles(dir, exts, maxDepth = 5) {
  const results = []
  const skip = new Set(['node_modules', '.git', 'target', 'dist', 'build', '.next', '.workspace'])
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

export function lintCheck(projectDir) {
  const errors = []
  const warnings = []

  // 架构文档检查
  if (!existsSync(join(projectDir, 'docs', 'ARCHITECTURE.md'))) {
    warnings.push('docs/ARCHITECTURE.md 不存在 — 建议运行"架构检查"')
  }

  // docs/ 大小约束检查（每个文档 ≤200 行）
  const docsDir = join(projectDir, 'docs')
  if (existsSync(docsDir)) {
    const docExts = new Set(['.md'])
    const docFiles = findFiles(docsDir, docExts, 3)
    for (const f of docFiles) {
      try {
        const content = readFileSync(f, 'utf-8')
        const lines = content.split('\n').length
        const relPath = f.replace(projectDir + '/', '')
        if (lines > 200) {
          warnings.push(`文档过大: ${relPath} (${lines} 行) — 建议拆分`)
        }
      } catch {}
    }
  }

  // 源代码文件大小检查（>500 行警告）
  const exts = new Set(['.ts', '.js', '.py', '.go', '.rs', '.tsx', '.jsx'])
  const files = findFiles(projectDir, exts)

  let largeFiles = 0
  for (const f of files) {
    try {
      const content = readFileSync(f, 'utf-8')
      const lines = content.split('\n').length
      if (lines > 500) {
        largeFiles++
      }
    } catch {}
  }

  if (largeFiles > 5) warnings.push(`${largeFiles} 个大文件（>500 行）— 考虑拆分`)

  if (errors.length > 0) return { exitCode: 1, message: `[lint-check] ${errors.length} 个问题\n${errors.join('\n')}` }
  if (warnings.length > 0) console.error(`[lint-check] ${warnings.length} 个警告`)
  return { exitCode: 0, message: '' }
}

if (process.argv[1]?.endsWith('lint-check.mjs')) {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd()
  const r = lintCheck(dir)
  if (r.message) {
    if (r.exitCode !== 0) console.error(r.message)
    else console.log(r.message)
  }
  process.exit(0)
}
