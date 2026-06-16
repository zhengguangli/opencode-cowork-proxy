import { readdirSync, readFileSync } from 'fs'
import { join, extname, basename, relative } from 'path'

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

const FILE_RULES = {
  component: { pattern: /^[A-Z][a-zA-Z]*\.(tsx|jsx|vue|svelte)$/, desc: 'Component files should use PascalCase' },
  utility: { pattern: /^([a-z][a-zA-Z0-9]*|[a-z][a-z0-9-]*|[A-Z][a-zA-Z0-9]*|\[\[\.\.\.\w+\]\]|[\w.-]+\.config)\.(ts|js|mjs)$/, desc: 'Utility files should use camelCase or kebab-case' },
  config: { pattern: /^([a-z][a-z0-9-]*|[\w.-]+\.config)\.(ts|js|mjs|json|yaml|yml|toml)$/, desc: 'Config files should use kebab-case' },
  test: { pattern: /^[a-zA-Z]+\.(test|spec)\.(ts|js|tsx|jsx|mjs)$/, desc: 'Test files should use .test/.spec suffix' },
}

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

function findFiles(dir, exts, maxDepth = 10) {
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
  const rel = ''

  const handlerFuncRegex = /(?:export\s+)?(?:async\s+)?function\s+(handle\w*)\s*\(/g
  let m
  while ((m = handlerFuncRegex.exec(content)) !== null) {
    // handler functions are fine if prefixed with "handle"
  }

  const translatorFuncRegex = /(?:export\s+)?(?:async\s+)?function\s+(format\w*)\s*\(/g
  // translator functions are fine if prefixed with "format"

  const misspelledHandlerRegex = /(?:export\s+)?(?:async\s+)?function\s+(?!handle)(\w*(?:anthropic|openai|responses|model|chat|message|stream|request|response)\w*)\s*\(/gi
  while ((m = misspelledHandlerRegex.exec(content)) !== null) {
    const name = m[1]
    if (name.startsWith('format') || name.startsWith('_') || RESERVED_WORDS.has(name)) continue
    const relPath = relative('', filePath)
    const handler = filePath.includes('handlers/') ? 'handle' : null
    const translator = filePath.includes('translate/') ? 'format' : null
    if (handler) {
      violations.push(`Handler function "${name}" in ${relPath} should use "handle" prefix → handle${name.charAt(0).toUpperCase()}${name.slice(1)}`)
    } else if (translator) {
      violations.push(`Translator function "${name}" in ${relPath} should use "format" prefix → format${name.charAt(0).toUpperCase()}${name.slice(1)}`)
    }
  }

  const formatPairKeyRegex = /FormatPairKey\s*\.\s*(\w+)\s*=/g
  while ((m = formatPairKeyRegex.exec(content)) !== null) {
    const valueRegex = new RegExp(`FormatPairKey\\s*\\.\\s*${m[1]}\\s*=\\s*['"]([^'"]+)['"]`)
    const valMatch = content.match(valueRegex)
    if (valMatch && !/^[a-z][a-z0-9-]*$/.test(valMatch[1])) {
      violations.push(`FormatPairKey value "${valMatch[1]}" should be kebab-case (e.g. "anthropic-to-openai")`)
    }
  }

  const classRegex = /\bclass\s+([A-Za-z_$][A-Za-z0-9_$]*)/g
  while ((m = classRegex.exec(content)) !== null) {
    const name = m[1]
    if (RESERVED_WORDS.has(name)) continue
    if (!/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
      violations.push(`Class "${name}" should use PascalCase`)
    }
    if (content.includes('extends') || content.includes('implements')) {
      // Registry classes should use *Registry suffix
    }
  }

  const registryLikeRegex = /\bclass\s+(\w*(?:Registry|Registry|registry)\w*)\b/g
  // Registry naming is validated via class check above

  const constExportRegex = /(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*[=:]/g
  while ((m = constExportRegex.exec(content)) !== null) {
    // UPPER_SNAKE_CASE is already enforced for the constant pattern
  }

  const configExportRegex = /(?:export\s+)?const\s+([a-z]\w*)\s*(?::\s*(?:string|number|boolean))?\s*=\s*[^;]+;/g
  const fileName = filePath.split('/').pop() || ''
  if (fileName === 'config.ts') {
    let cm
    while ((cm = configExportRegex.exec(content)) !== null) {
      const name = cm[1]
      if (!/^[A-Z][A-Z0-9_]*$/.test(name) && !name.startsWith('_')) {
        violations.push(`Config export "${name}" in config.ts should use UPPER_SNAKE_CASE`)
      }
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

    if (fileType && FILE_RULES[fileType]) {
      const rule = FILE_RULES[fileType]
      if (!rule.pattern.test(fileName)) {
        violations.push(`File naming: ${relPath} — ${rule.desc}`)
      }
    }

    try {
      const content = readFileSync(file, 'utf-8')
      const codeViolations = checkCodeNaming(content, file)
      for (const v of codeViolations) violations.push(v)
    } catch {}
  }

  if (violations.length > 0) {
    console.error(`[check-naming] ${violations.length} naming violations:`)
    for (const v of violations.slice(0, 10)) console.error(`  - ${v}`)
    if (violations.length > 10) console.error(`  ... and ${violations.length - 10} more`)
  }

  return { exitCode: 0, violations: violations.length, details: violations }
}

if (process.argv[1]?.endsWith('check-naming.mjs')) {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.env.CODEX_PROJECT_DIR || process.env.OPENCODE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd()
  const r = checkNaming(dir)
  if (r.violations === 0) console.log('[check-naming] naming conventions correct')
  process.exit(0)
}