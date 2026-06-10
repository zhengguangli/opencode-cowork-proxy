import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, extname, relative } from 'path'

// 文件大小阈值
const THRESHOLDS = {
  source: { warn: 300, error: 500 },    // 源代码文件
  test: { warn: 500, error: 1000 },     // 测试文件（可以更长）
  config: { warn: 200, error: 400 },    // 配置文件
  doc: { warn: 300, error: 600 },       // 文档文件（架构文档可以更长）
  style: { warn: 300, error: 500 },     // 样式文件
}

// 函数大小阈值
const FUNC_THRESHOLDS = { warn: 50, error: 100 }

function findFiles(dir, exts, maxDepth = 5) {
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

function classifyFile(filePath) {
  const ext = extname(filePath)
  const name = filePath.toLowerCase()

  if (/\.(test|spec)\./.test(name)) return 'test'
  if (/\.(json|yaml|yml|toml|env|config)/.test(ext)) return 'config'
  if (/\.(md|txt|rst)/.test(ext)) return 'doc'
  if (/\.(css|scss|less|sass)/.test(ext)) return 'style'
  return 'source'
}

function countFunctions(content, ext) {
  const funcs = []
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) {
    // function 声明
    const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g
    let m
    while ((m = funcRegex.exec(content)) !== null) funcs.push(m[1])
    // 箭头函数赋值
    const arrowRegex = /(?:export\s+)?const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s+)?\(/g
    while ((m = arrowRegex.exec(content)) !== null) funcs.push(m[1])
    // class 方法
    const methodRegex = /(?:async\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g
    while ((m = methodRegex.exec(content)) !== null) {
      if (!['if', 'for', 'while', 'switch', 'catch', 'return', 'import', 'export'].includes(m[1])) {
        funcs.push(m[1])
      }
    }
  } else if (ext === '.py') {
    const pyRegex = /def\s+([a-zA-Z_][a-zA-Z0-9_]*)/g
    let m
    while ((m = pyRegex.exec(content)) !== null) funcs.push(m[1])
  } else if (ext === '.go') {
    const goRegex = /func\s+(?:\([^)]*\)\s+)?([a-zA-Z_][a-zA-Z0-9_]*)/g
    let m
    while ((m = goRegex.exec(content)) !== null) funcs.push(m[1])
  }
  return funcs
}

export function checkFileSize(projectDir) {
  const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.rs', '.css', '.scss', '.md', '.json', '.yaml', '.yml'])
  const files = findFiles(projectDir, exts)
  const warnings = []
  const errors = []

  for (const file of files) {
    const relPath = relative(projectDir, file)
    const type = classifyFile(file)
    const threshold = THRESHOLDS[type] || THRESHOLDS.source

    try {
      const content = readFileSync(file, 'utf-8')
      const lines = content.split('\n').length

      if (lines > threshold.error) {
        errors.push(`${relPath}: ${lines} 行 (上限 ${threshold.error})`)
      } else if (lines > threshold.warn) {
        warnings.push(`${relPath}: ${lines} 行 (建议 ≤${threshold.warn})`)
      }

      // 函数大小检查（仅源代码）
      if (type === 'source') {
        const ext = extname(file)
        const funcs = countFunctions(content, ext)
        // 简化：检查每个函数的行数（通过空行分隔估算）
        if (funcs.length > 0 && lines / funcs.length > FUNC_THRESHOLDS.warn) {
          warnings.push(`${relPath}: 平均函数 ${Math.round(lines / funcs.length)} 行，函数过多或过大`)
        }
      }
    } catch {}
  }

  if (errors.length > 0) {
    console.error(`[check-file-size] ${errors.length} 个错误:`)
    for (const e of errors.slice(0, 10)) console.error(`  ✗ ${e}`)
  }
  if (warnings.length > 0) {
    console.error(`[check-file-size] ${warnings.length} 个警告:`)
    for (const w of warnings.slice(0, 10)) console.error(`  ⚠ ${w}`)
  }

  return { exitCode: 0, errors: errors.length, warnings: warnings.length, details: [...errors, ...warnings] }
}

if (process.argv[1]?.endsWith('check-file-size.mjs')) {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd()
  const r = checkFileSize(dir)
  if (r.errors === 0 && r.warnings === 0) console.log('[check-file-size] 文件大小合规')
  process.exit(0)
}
