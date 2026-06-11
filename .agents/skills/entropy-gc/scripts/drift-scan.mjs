#!/usr/bin/env node

import { execSync } from 'child_process'
import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync, readdirSync } from 'fs'
import { join, dirname, extname } from 'path'

function getWorkspaceDir(projectDir) {
  if (process.env.HARNESS_WORKSPACE) return process.env.HARNESS_WORKSPACE
  const root = projectDir
    || process.env.CLAUDE_PROJECT_DIR
    || process.env.CODEX_PROJECT_DIR
    || process.env.OPENCODE_PROJECT_DIR
    || process.env.PROJECT_DIR
    || process.cwd()
  return join(root, '.harness-pliot')
}

function findFiles(dir, exts) {
  const results = []
  const skip = new Set(['node_modules', '.git', 'target', 'dist', 'build'])
  function walk(d) {
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (skip.has(e.name)) continue
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (exts.has(extname(e.name))) results.push(full)
    }
  }
  walk(dir)
  return results
}

const MODE = process.argv[2] || '--quick'
const REPORT_FILE = process.env.REPORT_FILE || `${getWorkspaceDir()}/drift-scan-${getDateStr()}.md`
let errors = 0
let warnings = 0

function getDateStr() {
  const now = new Date()
  return now.toISOString().slice(0, 10).replace(/-/g, '')
}

function getTimestamp() {
  return new Date().toISOString()
}

mkdirSync(dirname(REPORT_FILE), { recursive: true })

let report = `# 漂移扫描报告

**日期:** ${getTimestamp()}
**模式:** ${MODE}

`

report += '## 架构漂移\n\n'

if (existsSync('docs/ARCHITECTURE.md')) {
  if (existsSync('src/types') && existsSync('src/services')) {
    try {
      const grepResult = execSync('grep -r "from.*services" src/types/ 2>/dev/null | grep -v node_modules | wc -l', { encoding: 'utf8' })
      const violations = parseInt(grepResult.trim()) || 0
      if (violations > 0) {
        report += `- ❌ types 层导入了 services 层: ${violations} 处\n`
        errors++
      } else {
        report += '- ✅ 分层方向正确\n'
      }
    } catch (e) {}
  }

  if (existsSync('go.mod')) {
    try {
      const goVet = execSync('go vet ./... 2>&1 | grep -i "import cycle" || true', { encoding: 'utf8' })
      if (goVet.trim()) {
        report += '- ❌ 检测到循环依赖\n'
        errors++
      } else {
        report += '- ✅ 无循环依赖\n'
      }
    } catch (e) {}
  }
} else {
  report += '- ⚠️ docs/ARCHITECTURE.md 不存在 — 无法检查架构漂移\n'
  warnings++
}

report += '\n'
report += '## 文档漂移\n\n'

let staleDocs = 0
const now = Date.now()

function findMdFiles(dir) {
  const results = []
  const skip = new Set(['node_modules', '.git'])
  function walk(d) {
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (skip.has(e.name)) continue
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.md')) results.push(full)
    }
  }
  if (existsSync(dir)) walk(dir)
  return results
}

const docFiles = findMdFiles('docs')
for (const doc of docFiles) {
  try {
    const stat = statSync(doc)
    const ageDays = Math.floor((now - stat.mtimeMs) / (1000 * 60 * 60 * 24))
    if (ageDays > 30) {
      report += `- ⚠️ \`${doc}\` — ${ageDays} 天未更新\n`
      staleDocs++
    }
  } catch (e) {}
}

if (staleDocs === 0) {
  report += '- ✅ 所有文档新鲜（<30 天）\n'
} else {
  warnings += staleDocs
}

report += '\n'

if (MODE === '--full') {
  report += '## 品味漂移\n\n'

  let largeFiles = 0
  const srcPatterns = ['**/*.ts', '**/*.js', '**/*.py', '**/*.go', '**/*.rs']
  const srcExts = new Set(['.ts', '.js', '.py', '.go', '.rs'])

  for (const file of findFiles('.', srcExts)) {
    try {
      const content = readFileSync(file, 'utf8')
      const lines = content.split('\n').length
      if (lines > 500) {
        report += `- ⚠️ \`${file}\` — ${lines} 行（>500）\n`
        largeFiles++
      }
    } catch (e) {}
  }

  if (largeFiles === 0) {
    report += '- ✅ 无过大的文件\n'
  } else {
    warnings += largeFiles
  }

  let todoCount = 0
  try {
    const rgResult = execSync('rg -c "TODO|FIXME" --type ts --type js --type py --type go --type rust -g \'!node_modules\' -g \'!.git\' . 2>/dev/null || true', { encoding: 'utf8' })
    if (rgResult.trim()) {
      todoCount = rgResult.trim().split('\n').reduce((sum, line) => {
        const count = parseInt(line.split(':').pop()) || 0
        return sum + count
      }, 0)
    }
  } catch (e) {}

  if (todoCount > 20) {
    report += `- ⚠️ TODO/FIXME 过多: ${todoCount} 个\n`
  } else {
    report += `- ✅ TODO/FIXME 数量正常 (${todoCount})\n`
  }

  report += '\n'
}

if (MODE === '--full') {
  report += '## 工具漂移\n\n'

  if (existsSync('package.json')) {
    report += '- ℹ️ 运行 `npx depcheck` 检查未使用的依赖\n'
  }

  if (existsSync('Cargo.toml')) {
    report += '- ℹ️ 运行 `cargo udeps` 检查未使用的依赖\n'
  }

  report += '\n'
}

report += '## 汇总\n\n'
report += `- 错误: ${errors}\n`
report += `- 警告: ${warnings}\n`

writeFileSync(REPORT_FILE, report)
console.log(`[drift-scan] 报告已生成: ${REPORT_FILE}`)
console.log(`[drift-scan] 错误: ${errors}, 警告: ${warnings}`)

if (errors > 0) {
  process.exit(1)
}
