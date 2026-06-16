#!/usr/bin/env node

import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'fs'
import { join, dirname, extname } from 'path'
import { execSync } from 'child_process'

function getWorkspaceDir(projectDir) {
  if (process.env.HARNESS_WORKSPACE) return process.env.HARNESS_WORKSPACE
  const root = projectDir
    || process.env.CLAUDE_PROJECT_DIR
    || process.env.CODEX_PROJECT_DIR
    || process.env.OPENCODE_PROJECT_DIR
    || process.env.PROJECT_DIR
    || process.cwd()
  return join(root, '.harness-pilot')
}

function findFiles(dir, exts, maxDepth = 20) {
  const results = []
  const skip = new Set(['node_modules', '.git', 'target', 'dist', 'build', '.next', '.workspace', '_workspace'])
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

const REPORT_FILE = process.env.REPORT_FILE || `${getWorkspaceDir()}/quality-score-${getDateStr()}.md`

function getDateStr() {
  const now = new Date()
  return now.toISOString().slice(0, 10).replace(/-/g, '')
}

function getTimestamp() {
  return new Date().toISOString()
}

mkdirSync(dirname(REPORT_FILE), { recursive: true })

const srcExts = new Set(['.ts', '.js', '.mjs'])
const srcFiles = findFiles('src', srcExts)
const testFiles = findFiles('test', srcExts)
const allFiles = findFiles('.', srcExts)

let translateTestFiles = 0
let streamTestFiles = 0
let archTestPass = false

for (const f of testFiles) {
  if (f.includes('translate') || f.includes('anthropic') || f.includes('openai') || f.includes('response')) {
    translateTestFiles++
  }
  if (f.includes('stream') || f.includes('sse')) {
    streamTestFiles++
  }
}

if (existsSync('test/architecture.test.ts')) {
  try {
    const result = execSync('npx vitest run test/architecture.test.ts 2>&1', { encoding: 'utf8', stdio: 'pipe' })
    archTestPass = !result.includes('failed') && !result.includes('FAIL')
  } catch {
    archTestPass = false
  }
}

let translationCoverage = 0
let streamCoverage = 0
const translateFiles = findFiles('src/translate', srcExts)
for (const f of translateFiles) {
  const baseName = f.split('/').pop()?.replace(/\.(ts|js|mjs)$/, '')
  if (!baseName) continue
  for (const tf of testFiles) {
    const testBase = tf.split('/').pop()?.replace(/\.(test|spec)\.(ts|js|mjs)$/, '')
    if (testBase && (baseName.includes(testBase) || testBase.includes(baseName))) {
      translationCoverage++
      break
    }
  }
}
translationCoverage = translateFiles.length > 0 ? Math.round((translationCoverage / translateFiles.length) * 100) : 0

const streamFiles = findFiles('src/translate/stream', srcExts)
let streamCovered = 0
for (const f of streamFiles) {
  const baseName = f.split('/').pop()?.replace(/\.(ts|js|mjs)$/, '')
  if (!baseName) continue
  for (const tf of testFiles) {
    if (tf.includes('stream') || tf.includes('sse')) {
      const testBase = tf.split('/').pop()?.replace(/\.(test|spec)\.(ts|js|mjs)$/, '')
      if (testBase && (baseName.includes(testBase) || testBase.includes(baseName))) {
        streamCovered++
        break
      }
    }
  }
}
streamCoverage = streamFiles.length > 0 ? Math.round((streamCovered / streamFiles.length) * 100) : 0

let anyCount = 0
let asAnyCount = 0
let tsIgnoreCount = 0
for (const file of allFiles) {
  try {
    const content = readFileSync(file, 'utf8')
    const anyMatches = content.match(/\bany\b/g)
    anyCount += anyMatches ? anyMatches.length : 0
    const asAnyMatches = content.match(/as\s+any/g)
    asAnyCount += asAnyMatches ? asAnyMatches.length : 0
    const tsIgnoreMatches = content.match(/\/\/\s*@ts-ignore/g)
    tsIgnoreCount += tsIgnoreMatches ? tsIgnoreMatches.length : 0
  } catch {}
}

let docFileCount = 0
const docExts = new Set(['.md'])
if (existsSync('docs')) {
  docFileCount = findFiles('docs', docExts).length
}

let todoCount = 0
for (const file of allFiles) {
  try {
    const content = readFileSync(file, 'utf8')
    const matches = content.match(/TODO|FIXME/g)
    if (matches) todoCount += matches.length
  } catch {}
}

let recentCommits = 0
try {
  const gitLog = execSync('git log --oneline -30 2>/dev/null || true', { encoding: 'utf8' })
  recentCommits = gitLog.trim() ? gitLog.trim().split('\n').length : 0
} catch {}

function scoreTranslationCoverage(pct) {
  if (pct >= 80) return 10
  if (pct >= 60) return 8
  if (pct >= 40) return 6
  if (pct >= 20) return 4
  return 2
}

function scoreStreamCoverage(pct) {
  if (pct >= 80) return 10
  if (pct >= 60) return 8
  if (pct >= 40) return 6
  if (pct >= 20) return 4
  return 2
}

function scoreArchitecture(pass) {
  return pass ? 10 : 3
}

function scoreDocs(count) {
  if (count >= 10) return 10
  if (count >= 5) return 8
  if (count >= 3) return 6
  if (count >= 1) return 4
  return 2
}

function scoreTypeSafety(anyCount, asAnyCount, tsIgnoreCount) {
  const total = anyCount + asAnyCount + tsIgnoreCount
  if (total === 0) return 10
  if (total <= 5) return 9
  if (total <= 15) return 7
  if (total <= 30) return 5
  return 3
}

const scores = {
  translationCoverage: scoreTranslationCoverage(translationCoverage),
  streamCoverage: scoreStreamCoverage(streamCoverage),
  architecture: scoreArchitecture(archTestPass),
  docs: scoreDocs(docFileCount),
  typeSafety: scoreTypeSafety(anyCount, asAnyCount, tsIgnoreCount),
}

const metrics = {
  srcFiles: srcFiles.length,
  translateFiles: translateFiles.length,
  streamFiles: streamFiles.length,
  testFiles: testFiles.length,
  translateTestFiles,
  streamTestFiles,
  translationCoverage,
  streamCoverage,
  docFileCount,
  anyCount,
  asAnyCount,
  tsIgnoreCount,
  todoCount,
  recentCommits,
}

let report = `# Quality Score Report

**Date:** ${getTimestamp()}

## Overview

| Metric | Value |
|--------|-------|
| Source files | ${metrics.srcFiles} |
| Translate files | ${metrics.translateFiles} |
| Stream files | ${metrics.streamFiles} |
| Test files | ${metrics.testFiles} |
| Translation tests | ${metrics.translateTestFiles} |
| Stream tests | ${metrics.streamTestFiles} |
| Documentation files | ${metrics.docFileCount} |
| TODO/FIXME | ${metrics.todoCount} |
| \`any\` uses | ${metrics.anyCount} |
| \`as any\` uses | ${metrics.asAnyCount} |
| \`@ts-ignore\` | ${metrics.tsIgnoreCount} |
| Recent commits | ${metrics.recentCommits} |

## Scores

| Dimension | Score (0-10) | Detail |
|-----------|-------------|--------|
| Translation coverage | ${scores.translationCoverage} | ${metrics.translationCoverage}% (${metrics.translateTestFiles} test files) |
| Streaming coverage | ${scores.streamCoverage} | ${metrics.streamCoverage}% (${metrics.streamTestFiles} test files) |
| Architecture compliance | ${scores.architecture} | ${archTestPass ? 'architecture.test.ts passed' : 'architecture.test.ts failed or not found'} |
| Documentation completeness | ${scores.docs} | ${metrics.docFileCount} doc files |
| Type safety | ${scores.typeSafety} | ${metrics.anyCount} any, ${metrics.asAnyCount} as any, ${metrics.tsIgnoreCount} @ts-ignore |

## Recommendations

`

if (metrics.translationCoverage < 60) {
  report += `- Add more tests covering src/translate/ (current: ${metrics.translationCoverage}%)\n`
}
if (metrics.streamCoverage < 60) {
  report += `- Add more tests covering src/translate/stream/ (current: ${metrics.streamCoverage}%)\n`
}
if (!archTestPass) {
  report += '- Fix or create test/architecture.test.ts to validate architecture boundaries\n'
}
if (metrics.anyCount > 15) {
  report += `- Reduce \`any\` usage (current: ${metrics.anyCount})\n`
}
if (metrics.asAnyCount > 10) {
  report += `- Reduce \`as any\` casts (current: ${metrics.asAnyCount})\n`
}
if (metrics.docFileCount < 5) {
  report += `- Add more documentation (current: ${metrics.docFileCount} files)\n`
}
if (metrics.todoCount > 20) {
  report += `- Clean up TODO/FIXME (current: ${metrics.todoCount})\n`
}

report += '\n'

writeFileSync(REPORT_FILE, report)
console.log(`[quality-score] report generated: ${REPORT_FILE}`)