import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, extname, relative } from 'path'

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

function checkTypeScript(content, relPath) {
  const violations = []

  // any 类型
  const anyRegex = /:\s*any\b/g
  const anyMatches = content.match(anyRegex)
  if (anyMatches && anyMatches.length > 0) {
    violations.push(`${relPath}: 使用了 ${anyMatches.length} 次 any 类型`)
  }

  // as 类型断言
  const asRegex = /\bas\s+[A-Z]\w+/g
  const asMatches = content.match(asRegex)
  if (asMatches && asMatches.length > 2) {
    violations.push(`${relPath}: 使用了 ${asMatches.length} 次 as 断言（过多）`)
  }

  // @ts-ignore / @ts-expect-error
  const ignoreRegex = /@ts-ignore|@ts-expect-error/g
  const ignoreMatches = content.match(ignoreRegex)
  if (ignoreMatches && ignoreMatches.length > 0) {
    violations.push(`${relPath}: 使用了 ${ignoreMatches.length} 次 @ts-ignore/@ts-expect-error`)
  }

  // 非空断言 !
  const nonNullRegex = /\w+!\./g
  const nonNullMatches = content.match(nonNullRegex)
  if (nonNullMatches && nonNullMatches.length > 3) {
    violations.push(`${relPath}: 使用了 ${nonNullMatches.length} 次非空断言 !（过多）`)
  }

  return violations
}

function checkPython(content, relPath) {
  const violations = []

  // 无类型注解的函数
  const funcRegex = /def\s+\w+\s*\([^)]*\)\s*:/g
  const funcs = content.match(funcRegex) || []
  const noReturnRegex = /def\s+\w+\s*\([^)]*\)\s*(?!->)\s*:/g
  const noReturn = content.match(noReturnRegex) || []
  if (noReturn.length > 0) {
    violations.push(`${relPath}: ${noReturn.length} 个函数缺少返回类型注解`)
  }

  // dict 直传（无 TypedDict/dataclass）
  const dictLiteralRegex = /\{\s*['"][^'"]+['"]\s*:/g
  const dictMatches = content.match(dictLiteralRegex) || []
  if (dictMatches.length > 3) {
    violations.push(`${relPath}: ${dictMatches.length} 个 dict 字面量（考虑使用 TypedDict/dataclass）`)
  }

  // type: ignore
  const typeIgnoreRegex = /# type:\s*ignore/g
  const typeIgnoreMatches = content.match(typeIgnoreRegex) || []
  if (typeIgnoreMatches.length > 0) {
    violations.push(`${relPath}: 使用了 ${typeIgnoreMatches.length} 次 type: ignore`)
  }

  return violations
}

function checkGo(content, relPath) {
  const violations = []

  // interface{} （应使用 any 或具体类型）
  const emptyInterfaceRegex = /interface\s*\{\}/g
  const emptyMatches = content.match(emptyInterfaceRegex) || []
  if (emptyMatches.length > 0) {
    violations.push(`${relPath}: 使用了 ${emptyMatches.length} 次 interface{}（考虑使用 any 或具体类型）`)
  }

  // 忽略 error
  const ignoreErrRegex = /_\s*=\s*\w+\([^)]*\)/g
  const ignoreErrMatches = content.match(ignoreErrRegex) || []
  if (ignoreErrMatches.length > 0) {
    violations.push(`${relPath}: 可能忽略了 ${ignoreErrMatches.length} 个返回值`)
  }

  // panic
  const panicRegex = /panic\s*\(/g
  const panicMatches = content.match(panicRegex) || []
  if (panicMatches.length > 0) {
    violations.push(`${relPath}: 使用了 ${panicMatches.length} 次 panic（应使用 error 返回）`)
  }

  return violations
}

function checkRust(content, relPath) {
  const violations = []

  // unwrap()
  const unwrapRegex = /\.unwrap\(\)/g
  const unwrapMatches = content.match(unwrapRegex) || []
  if (unwrapMatches.length > 0) {
    violations.push(`${relPath}: 使用了 ${unwrapMatches.length} 次 .unwrap()（应使用 ? 或 match）`)
  }

  // panic!
  const panicRegex = /panic!\s*\(/g
  const panicMatches = content.match(panicRegex) || []
  if (panicMatches.length > 0) {
    violations.push(`${relPath}: 使用了 ${panicMatches.length} 次 panic!`)
  }

  // unsafe
  const unsafeRegex = /unsafe\s*\{/g
  const unsafeMatches = content.match(unsafeRegex) || []
  if (unsafeMatches.length > 0) {
    violations.push(`${relPath}: 使用了 ${unsafeMatches.length} 个 unsafe 块`)
  }

  return violations
}

export function checkTypeSafety(projectDir) {
  const tsExts = new Set(['.ts', '.tsx'])
  const pyExts = new Set(['.py'])
  const goExts = new Set(['.go'])
  const rsExts = new Set(['.rs'])

  const violations = []

  // TypeScript
  for (const file of findFiles(projectDir, tsExts)) {
    const relPath = relative(projectDir, file)
    try {
      const content = readFileSync(file, 'utf-8')
      violations.push(...checkTypeScript(content, relPath))
    } catch {}
  }

  // Python
  for (const file of findFiles(projectDir, pyExts)) {
    const relPath = relative(projectDir, file)
    try {
      const content = readFileSync(file, 'utf-8')
      violations.push(...checkPython(content, relPath))
    } catch {}
  }

  // Go
  for (const file of findFiles(projectDir, goExts)) {
    const relPath = relative(projectDir, file)
    try {
      const content = readFileSync(file, 'utf-8')
      violations.push(...checkGo(content, relPath))
    } catch {}
  }

  // Rust
  for (const file of findFiles(projectDir, rsExts)) {
    const relPath = relative(projectDir, file)
    try {
      const content = readFileSync(file, 'utf-8')
      violations.push(...checkRust(content, relPath))
    } catch {}
  }

  if (violations.length > 0) {
    console.error(`[check-type-safety] ${violations.length} 个类型安全问题:`)
    for (const v of violations.slice(0, 10)) console.error(`  - ${v}`)
    if (violations.length > 10) console.error(`  ... 还有 ${violations.length - 10} 个`)
  }

  return { exitCode: 0, violations: violations.length, details: violations }
}

if (process.argv[1]?.endsWith('check-type-safety.mjs')) {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd()
  const r = checkTypeSafety(dir)
  if (r.violations === 0) console.log('[check-type-safety] 类型安全合规')
  process.exit(0)
}
