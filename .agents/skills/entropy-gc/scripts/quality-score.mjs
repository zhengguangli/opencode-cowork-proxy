#!/usr/bin/env node

import { execSync } from 'child_process'
import { mkdirSync, writeFileSync, existsSync, statSync, readdirSync, readFileSync } from 'fs'
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

const REPORT_FILE = process.env.REPORT_FILE || `${getWorkspaceDir()}/quality-score-${getDateStr()}.md`

function getDateStr() {
  const now = new Date()
  return now.toISOString().slice(0, 10).replace(/-/g, '')
}

function getTimestamp() {
  return new Date().toISOString()
}

mkdirSync(dirname(REPORT_FILE), { recursive: true })

function collect() {
  const srcPatterns = ['**/*.ts', '**/*.js', '**/*.py', '**/*.go', '**/*.rs']
  const exts = new Set(['.ts', '.js', '.py', '.go', '.rs'])
  let fileCount = 0
  for (const ext of exts) {
    fileCount += findFiles('.', new Set([ext])).length
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

  let largeFiles = 0
  for (const ext of exts) {
    for (const file of findFiles('.', new Set([ext]))) {
      try {
        const content = readFileSync(file, 'utf8')
        const lines = content.split('\n').length
        if (lines > 500) largeFiles++
      } catch (e) {}
    }
  }

  let testFiles = 0
  const testExts = new Set(['.ts', '.js', '.py', '.go', '.rs'])
  for (const ext of testExts) {
    for (const file of findFiles('.', new Set([ext]))) {
      if (/\.(test|spec)\./.test(file) || /_test\./.test(file)) testFiles++
    }
  }

  let docFiles = 0
  try {
    for (const file of findFiles('docs', new Set(['.md']))) {
      docFiles++
    }
  } catch (e) {}

  let recentCommits = 0
  try {
    const gitLog = execSync('git log --oneline -30 2>/dev/null || true', { encoding: 'utf8' })
    recentCommits = gitLog.trim() ? gitLog.trim().split('\n').length : 0
  } catch (e) {}

  return { fileCount, todoCount, largeFiles, testFiles, docFiles, recentCommits }
}

function scoreFileSize(largeFiles) {
  if (largeFiles === 0) return 10
  if (largeFiles <= 2) return 8
  if (largeFiles <= 5) return 6
  return 4
}

function scoreTodo(todoCount) {
  if (todoCount === 0) return 10
  if (todoCount <= 10) return 9
  if (todoCount <= 20) return 7
  if (todoCount <= 50) return 5
  return 3
}

function scoreTestCoverage(fileCount, testFiles) {
  if (fileCount === 0) return 'N/A'
  const ratio = (testFiles * 100) / fileCount
  if (ratio >= 80) return 10
  if (ratio >= 50) return 8
  if (ratio >= 30) return 6
  if (ratio >= 10) return 4
  return 2
}

function scoreDocs(docFiles) {
  if (docFiles >= 10) return 10
  if (docFiles >= 5) return 8
  if (docFiles >= 3) return 6
  if (docFiles >= 1) return 4
  return 2
}

function scoreArchitecture() {
  return existsSync('docs/ARCHITECTURE.md') ? 8 : 3
}

const metrics = collect()
const scores = {
  fileSize: scoreFileSize(metrics.largeFiles),
  todo: scoreTodo(metrics.todoCount),
  testCoverage: scoreTestCoverage(metrics.fileCount, metrics.testFiles),
  docs: scoreDocs(metrics.docFiles),
  architecture: scoreArchitecture()
}

let report = `# 质量评分报告

**日期:** ${getTimestamp()}

## 总览

| 指标 | 值 |
|------|-----|
| 源文件数 | ${metrics.fileCount} |
| 测试文件数 | ${metrics.testFiles} |
| 文档数 | ${metrics.docFiles} |
| TODO/FIXME | ${metrics.todoCount} |
| 大文件(>500行) | ${metrics.largeFiles} |
| 近30天提交 | ${metrics.recentCommits} |

## 评分

| 维度 | 评分 (0-10) | 说明 |
|------|------------|------|
| 文件大小 | ${scores.fileSize} | ${metrics.largeFiles} 个大文件 |
| 技术债务 | ${scores.todo} | ${metrics.todoCount} 个 TODO/FIXME |
| 测试覆盖 | ${scores.testCoverage} | ${metrics.testFiles} 个测试文件 / ${metrics.fileCount} 个源文件 |
| 文档完整性 | ${scores.docs} | ${metrics.docFiles} 个文档 |
| 架构定义 | ${scores.architecture} | ${existsSync('docs/ARCHITECTURE.md') ? '已定义' : '缺失'} |

## 建议

`

if (metrics.largeFiles > 0) {
  report += `- 拆分 ${metrics.largeFiles} 个大文件（>500 行）\n`
}
if (metrics.todoCount > 20) {
  report += `- 清理 ${metrics.todoCount} 个 TODO/FIXME\n`
}
if (!existsSync('docs/ARCHITECTURE.md')) {
  report += '- 创建 docs/ARCHITECTURE.md 定义架构边界\n'
}
if (metrics.docFiles < 5) {
  report += `- 补充文档（当前仅 ${metrics.docFiles} 个）\n`
}

report += '\n'

writeFileSync(REPORT_FILE, report)
console.log(`[quality-score] 报告已生成: ${REPORT_FILE}`)
