import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, extname, basename, relative } from 'path'

function getWorkspaceDir(projectDir) {
  if (process.env.HARNESS_WORKSPACE) return process.env.HARNESS_WORKSPACE
  const root = projectDir
    || process.env.CLAUDE_PROJECT_DIR
    || process.env.CODEX_PROJECT_DIR
    || process.env.OPENCODE_PROJECT_DIR
    || process.env.PROJECT_DIR
    || process.cwd()
  return join(root, '.harness-polit')
}

// 命名约定规则
const RULES = {
  file: {
    component: { pattern: /^[A-Z][a-zA-Z]*\.(tsx|jsx|vue|svelte)$/, desc: '组件文件应使用 PascalCase' },
    // 允许 camelCase、kebab-case、PascalCase、[[...route]] 动态路由、.config. 文件
    utility: { pattern: /^([a-z][a-zA-Z0-9]*|[a-z][a-z0-9-]*|[A-Z][a-zA-Z0-9]*|\[\[\.\.\.\w+\]\]|[\w.-]+\.config)\.(ts|js|mjs)$/, desc: '工具文件应使用 camelCase 或 kebab-case' },
    config: { pattern: /^([a-z][a-z0-9-]*|[\w.-]+\.config)\.(ts|js|mjs|json|yaml|yml|toml)$/, desc: '配置文件应使用 kebab-case' },
    test: { pattern: /^[a-zA-Z]+\.(test|spec)\.(ts|js|tsx|jsx|mjs)$/, desc: '测试文件应使用 .test/.spec 后缀' },
  },
  variable: {
    constant: { pattern: /^[A-Z][A-Z0-9_]*$/, desc: '常量应使用 UPPER_SNAKE_CASE' },
    identifier: { pattern: /^[a-z][a-zA-Z0-9]*$/, desc: '变量/函数应使用 camelCase' },
    type: { pattern: /^[A-Z][a-zA-Z0-9]*$/, desc: '类型应使用 PascalCase' },
    private: { pattern: /^[_#][a-z][a-zA-Z0-9]*$/, desc: '私有成员应使用 _camelCase 或 #camelCase' },
  },
}

// TypeScript/JS 保留字（不应被识别为类型名）
const RESERVED_WORDS = new Set([
  'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
  'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export',
  'extends', 'false', 'finally', 'for', 'from', 'function', 'get', 'if',
  'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'module',
  'namespace', 'new', 'null', 'of', 'package', 'private', 'protected', 'public',
  'readonly', 'return', 'set', 'static', 'super', 'switch', 'this', 'throw',
  'true', 'try', 'type', 'typeof', 'undefined', 'var', 'void', 'while', 'with',
  'yield',
])

function classifyFile(filePath) {
  const name = basename(filePath)
  const ext = extname(filePath)
  if (/\.(tsx|jsx|vue|svelte)$/.test(ext)) return 'component'
  if (/\.(test|spec)\./.test(name)) return 'test'
  if (/\.config\./.test(name) || /\.(json|yaml|yml|toml|env)/.test(ext)) return 'config'
  if (/\.(ts|js|mjs)$/.test(ext)) return 'utility'
  return null
}

function findFiles(dir, exts, maxDepth = 5) {
  const results = []
  const skip = new Set(['node_modules', '.git', 'target', 'dist', 'build', '.next', '.workspace', '_workspace', basename(getWorkspaceDir())])
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

function checkCodeNaming(content, filePath) {
  const violations = []
  const ext = extname(filePath)
  if (!['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) return violations

  // 常量声明
  const constRegex = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[=:]/g
  let m
  while ((m = constRegex.exec(content)) !== null) {
    const name = m[1]
    if (name === name.toUpperCase() && name.length > 1 && !/^[A-Z][A-Z0-9_]*$/.test(name)) {
      violations.push(`常量命名: "${name}" 应使用 UPPER_SNAKE_CASE`)
    }
  }

  // class 声明
  const classRegex = /\bclass\s+([A-Za-z_$][A-Za-z0-9_$]*)/g
  while ((m = classRegex.exec(content)) !== null) {
    const name = m[1]
    if (!RESERVED_WORDS.has(name) && !/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
      violations.push(`类命名: "${name}" 应使用 PascalCase`)
    }
  }

  // interface/type 声明 — 精确匹配，排除保留字
  const typeRegex = /\b(?:interface|type)\s+([A-Z_a-z][A-Za-z0-9_$]*)\s*(?:<|{|=|extends|implements)/g
  while ((m = typeRegex.exec(content)) !== null) {
    const name = m[1]
    if (RESERVED_WORDS.has(name)) continue
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
      violations.push(`类型命名: "${name}" 应使用 PascalCase`)
    }
  }

  return violations
}

export function checkNaming(projectDir) {
  const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue', '.svelte'])
  const files = findFiles(projectDir, exts)
  const violations = []

  for (const file of files) {
    const relPath = relative(projectDir, file)
    const fileName = basename(file)
    const fileType = classifyFile(file)

    if (fileType && RULES.file[fileType]) {
      const rule = RULES.file[fileType]
      if (!rule.pattern.test(fileName)) {
        violations.push(`文件命名: ${relPath} — ${rule.desc}`)
      }
    }

    try {
      const content = readFileSync(file, 'utf-8')
      const codeViolations = checkCodeNaming(content, file)
      for (const v of codeViolations) {
        violations.push(`${relPath}: ${v}`)
      }
    } catch {}
  }

  if (violations.length > 0) {
    console.error(`[check-naming] ${violations.length} 个命名违规:`)
    for (const v of violations.slice(0, 10)) console.error(`  - ${v}`)
    if (violations.length > 10) console.error(`  ... 还有 ${violations.length - 10} 个`)
  }

  return { exitCode: 0, violations: violations.length, details: violations }
}

if (process.argv[1]?.endsWith('check-naming.mjs')) {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.env.CODEX_PROJECT_DIR || process.env.OPENCODE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd()
  const r = checkNaming(dir)
  if (r.violations === 0) console.log('[check-naming] 命名规范正确')
  process.exit(0)
}
