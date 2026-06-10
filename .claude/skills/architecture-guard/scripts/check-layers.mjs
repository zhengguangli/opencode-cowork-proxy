import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, extname, relative } from 'path'

// 分层定义（依赖方向：上层可依赖下层，反之违规）
const LAYERS = ['types', 'config', 'repo', 'service', 'runtime', 'ui', 'components', 'pages', 'app']

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

function detectLayer(filePath, projectDir) {
  const rel = relative(projectDir, filePath).toLowerCase().replace(/\\/g, '/')
  for (const layer of LAYERS) {
    if (rel.includes(`/${layer}/`) || rel.startsWith(`${layer}/`)) return layer
  }
  return null
}

function extractImports(content, filePath) {
  const imports = []
  const ext = extname(filePath)

  if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) {
    // ES imports
    const esRegex = /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g
    let m
    while ((m = esRegex.exec(content)) !== null) imports.push(m[1])
    // require
    const reqRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    while ((m = reqRegex.exec(content)) !== null) imports.push(m[1])
  } else if (ext === '.py') {
    const pyRegex = /(?:from\s+(\S+)\s+import|import\s+(\S+))/g
    let m
    while ((m = pyRegex.exec(content)) !== null) imports.push(m[1] || m[2])
  } else if (ext === '.go') {
    const goRegex = /import\s+(?:\(\s*)?["']([^"']+)["']/g
    let m
    while ((m = goRegex.exec(content)) !== null) imports.push(m[1])
  }

  return imports
}

function resolveImportLayer(imp, projectDir) {
  // 相对路径
  if (imp.startsWith('.')) {
    // 需要解析，这里简化处理
    for (const layer of LAYERS) {
      if (imp.toLowerCase().includes(`/${layer}/`) || imp.toLowerCase().startsWith(`${layer}/`)) return layer
    }
  }
  // 别名路径（@/、~/等）
  const cleaned = imp.replace(/^[@~]\//, '')
  for (const layer of LAYERS) {
    if (cleaned.toLowerCase().includes(layer)) return layer
  }
  return null
}

export function checkLayers(projectDir) {
  const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go'])
  const files = findFiles(projectDir, exts)
  const violations = []

  for (const file of files) {
    const fileLayer = detectLayer(file, projectDir)
    if (!fileLayer) continue

    const content = readFileSync(file, 'utf-8')
    const imports = extractImports(content, file)
    const fileLayerIdx = LAYERS.indexOf(fileLayer)

    for (const imp of imports) {
      if (imp.startsWith('.')) continue // 跳过相对路径（简化）
      const importLayer = resolveImportLayer(imp, projectDir)
      if (!importLayer) continue

      const importLayerIdx = LAYERS.indexOf(importLayer)
      // 上层导入下层 = 违规（types 不应导入 service）
      if (importLayerIdx > fileLayerIdx) {
        const relPath = relative(projectDir, file)
        violations.push(`${relPath}: ${fileLayer} 层导入了 ${importLayer} 层 (${imp})`)
      }
    }
  }

  if (violations.length > 0) {
    console.error(`[check-layers] ${violations.length} 个依赖方向违规:`)
    for (const v of violations.slice(0, 10)) console.error(`  - ${v}`)
    if (violations.length > 10) console.error(`  ... 还有 ${violations.length - 10} 个`)
  }

  return { exitCode: 0, violations: violations.length, details: violations }
}

if (process.argv[1]?.endsWith('check-layers.mjs')) {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd()
  const r = checkLayers(dir)
  if (r.violations === 0) console.log('[check-layers] 依赖方向正确')
  process.exit(0)
}
