#!/usr/bin/env node

import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync, readdirSync } from 'fs'
import { join, dirname, extname, relative } from 'path'

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

function readFileImports(fileContent) {
  const imports = []
  const esRegex = /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g
  let m
  while ((m = esRegex.exec(fileContent)) !== null) imports.push(m[1])
  return imports
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

let report = `# Drift Scan Report

**Date:** ${getTimestamp()}
**Mode:** ${MODE}

`

report += '## Architecture Drift\n\n'

const srcExts = new Set(['.ts', '.js', '.mjs'])

if (existsSync('src/translate') && existsSync('src/handlers')) {
  const translateFiles = findFiles('src/translate', srcExts)
  let violationCount = 0
  const violationDetails = []

  for (const file of translateFiles) {
    try {
      const content = readFileSync(file, 'utf-8')
      const imports = readFileImports(content)
      for (const imp of imports) {
        if (imp.includes('handlers/') || imp.includes('/handlers') || imp === 'handlers' || imp.includes('handlers')) {
          violationCount++
          const rel = relative('', file)
          violationDetails.push(`${rel}: translate layer imports from handlers layer (${imp})`)
        }
      }
    } catch {}
  }

  if (violationCount > 0) {
    report += `- ❌ translate layer imports from handlers layer: ${violationCount} violations\n`
    for (const detail of violationDetails.slice(0, 5)) {
      report += `  - ${detail}\n`
    }
    if (violationDetails.length > 5) {
      report += `  ... and ${violationDetails.length - 5} more\n`
    }
    errors++
  } else {
    report += '- ✅ Layer direction correct: translate/ does not import from handlers/\n'
  }

  const handlerFiles = findFiles('src/handlers', srcExts)
  let handlerViolationCount = 0
  const handlerViolationDetails = []

  for (const file of handlerFiles) {
    try {
      const content = readFileSync(file, 'utf-8')
      const imports = readFileImports(content)
      for (const imp of imports) {
        if (imp.includes('providers') && !imp.startsWith('.') && !imp.startsWith('@')) {
          // Handlers importing providers directly is fine (layer 1 -> layer 2 is upward, but allowed via cross-cutting)
        }
      }
    } catch {}
  }

  const configFiles = ['src/config.ts']
  for (const cfg of configFiles) {
    if (!existsSync(cfg)) continue
    try {
      const content = readFileSync(cfg, 'utf-8')
      const imports = readFileImports(content)
      let configViolations = 0
      for (const imp of imports) {
        if (imp.startsWith('.') ) continue
        if (imp.startsWith('src/') || imp.startsWith('@/')) {
          const cleaned = imp.replace(/^@\//, '').replace(/^src\//, '')
          if (!cleaned.startsWith('config') && !cleaned.startsWith('version')) {
            configViolations++
          }
        }
      }
      if (configViolations > 0) {
        report += `- ❌ config.ts imports from other src/ modules: ${configViolations} violations\n`
        errors++
      } else {
        report += '- ✅ config.ts has no upward dependencies\n'
      }
    } catch {}
  }
} else {
  report += '- ⚠️ src/translate or src/handlers directory not found — cannot check architecture drift\n'
  warnings++
}

if (!existsSync('docs/ARCHITECTURE.md')) {
  report += '- ⚠️ docs/ARCHITECTURE.md missing — cannot verify architecture definition\n'
  warnings++
}

report += '\n'
report += '## Documentation Drift\n\n'

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
let staleDocs = 0
for (const doc of docFiles) {
  try {
    const stat = statSync(doc)
    const ageDays = Math.floor((now - stat.mtimeMs) / (1000 * 60 * 60 * 24))
    if (ageDays > 30) {
      report += `- ⚠️ \`${doc}\` — ${ageDays} days since last update\n`
      staleDocs++
    }
  } catch {}
}

if (staleDocs === 0) {
  report += '- ✅ All documentation fresh (<30 days)\n'
} else {
  warnings += staleDocs
}

report += '\n'

if (MODE === '--full') {
  report += '## Taste Drift\n\n'

  let largeFiles = 0
  for (const file of findFiles('src', srcExts)) {
    try {
      const content = readFileSync(file, 'utf8')
      const lines = content.split('\n').length
      if (lines > 500) {
        report += `- ⚠️ \`${relative('', file)}\` — ${lines} lines (>500)\n`
        largeFiles++
      }
    } catch {}
  }

  if (largeFiles === 0) {
    report += '- ✅ No oversized files\n'
  } else {
    warnings += largeFiles
  }

  let todoCount = 0
  for (const file of findFiles('.', srcExts)) {
    try {
      const content = readFileSync(file, 'utf8')
      const matches = content.match(/TODO|FIXME/g)
      if (matches) todoCount += matches.length
    } catch {}
  }

  if (todoCount > 20) {
    report += `- ⚠️ Too many TODO/FIXME: ${todoCount}\n`
  } else {
    report += `- ✅ TODO/FIXME count normal (${todoCount})\n`
  }

  report += '\n'
}

if (MODE === '--full') {
  report += '## Dependency Drift\n\n'

  if (existsSync('package.json')) {
    report += '- ℹ️ Run `npx depcheck` to check for unused dependencies\n'
  }

  if (existsSync('Cargo.toml')) {
    report += '- ℹ️ Run `cargo udeps` to check for unused dependencies\n'
  }

  report += '\n'
}

report += '## Summary\n\n'
report += `- Errors: ${errors}\n`
report += `- Warnings: ${warnings}\n`

writeFileSync(REPORT_FILE, report)
console.log(`[drift-scan] report generated: ${REPORT_FILE}`)
console.log(`[drift-scan] errors: ${errors}, warnings: ${warnings}`)

if (errors > 0) {
  process.exit(1)
}