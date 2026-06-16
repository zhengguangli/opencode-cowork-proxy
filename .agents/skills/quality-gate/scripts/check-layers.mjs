import { readdirSync, readFileSync } from 'fs'
import { join, extname, relative, basename } from 'path'

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

const LAYERS = ['translate', 'handlers', 'providers', 'routing', 'config']

const CROSS_CUTTING = new Set([
  'auth.ts', 'validate.ts', 'audit.ts', 'logger.ts', 'request.ts',
  'vision.ts', 'compress.ts', 'backpressure.ts', 'rate-limit.ts',
  'response-cache.ts', 'think-tag-stripper.ts', 'cache.ts', 'version.ts',
])

const LAYER_RULES = [
  { layer: 'translate', index: 0, forbidden: ['handlers', 'providers', 'routing', 'request.ts', 'index.ts'] },
  { layer: 'handlers', index: 1, forbidden: [] },
  { layer: 'providers', index: 2, forbidden: [] },
  { layer: 'routing', index: 3, forbidden: [] },
  { layer: 'config', index: 4, forbidden: ['translate', 'handlers', 'providers', 'routing', 'request.ts', 'index.ts'] },
]

const SKIP = new Set(['node_modules', '.git', 'target', 'dist', 'build', '.next', '.workspace', basename(getWorkspaceDir())])

function findFiles(dir, exts, maxDepth = 10) {
  const results = []
  function walk(d, depth) {
    if (depth > maxDepth) return
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue
      const full = join(d, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else if (exts.has(extname(e.name))) results.push(full)
    }
  }
  walk(dir, 0)
  return results
}

function detectLayer(filePath, projectDir) {
  const rel = relative(projectDir, filePath).replace(/\\/g, '/')
  if (rel.startsWith('src/translate/')) return 'translate'
  if (rel.startsWith('src/handlers/')) return 'handlers'
  if (rel.startsWith('src/providers')) return 'providers'
  if (rel.startsWith('src/routing')) return 'routing'
  if (rel.startsWith('src/config')) return 'config'
  const fileName = rel.split('/').pop()
  if (CROSS_CUTTING.has(fileName)) return 'cross-cutting'
  return null
}

function extractImports(content) {
  const imports = []
  const esRegex = /import\s+(?:.*?\s+from\s+)?['"]([^'"]+)['"]/g
  let m
  while ((m = esRegex.exec(content)) !== null) imports.push(m[1])
  const reqRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((m = reqRegex.exec(content)) !== null) imports.push(m[1])
  return imports
}

function resolveImportTarget(imp) {
  const cleaned = imp.replace(/^[@~]\//, '').replace(/^src\//, '')
  if (cleaned.startsWith('translate/') || cleaned === 'translate') return { type: 'layer', layer: 'translate' }
  if (cleaned.startsWith('handlers/') || cleaned === 'handlers') return { type: 'layer', layer: 'handlers' }
  if (cleaned.startsWith('providers') || cleaned === 'providers') return { type: 'layer', layer: 'providers' }
  if (cleaned.startsWith('routing') || cleaned === 'routing') return { type: 'layer', layer: 'routing' }
  if (cleaned.startsWith('config') || cleaned === 'config') return { type: 'layer', layer: 'config' }
  const fileName = cleaned.split('/').pop()?.split('.').shift() + '.ts'
  if (CROSS_CUTTING.has(fileName)) return { type: 'cross-cutting' }
  return null
}

function checkForbidden(imp, fileLayer) {
  if (imp.startsWith('.')) return null
  const target = resolveImportTarget(imp)
  if (!target || target.type === 'cross-cutting') return null
  const rule = LAYER_RULES.find(r => r.layer === fileLayer)
  if (!rule) return null
  const prohibitedFromThisLayer = rule.forbidden
  const targetLayer = target.layer
  if (prohibitedFromThisLayer.includes(targetLayer)) {
    return `${targetLayer} (layer ${LAYERS.indexOf(targetLayer)}) imported from ${fileLayer} (layer ${LAYERS.indexOf(fileLayer)})`
  }
  if (typeof targetLayer === 'string' && typeof fileLayer === 'string') {
    const targetIdx = LAYERS.indexOf(targetLayer)
    const fileIdx = LAYERS.indexOf(fileLayer)
    if (targetIdx < fileIdx) return null
    if (targetIdx > fileIdx) {
      return `${targetLayer} (layer ${targetIdx}) imported from ${fileLayer} (layer ${fileIdx}) — upward dependency`
    }
  }
  return null
}

export function checkLayers(projectDir) {
  const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])
  const files = findFiles(projectDir, exts)
  const violations = []

  for (const file of files) {
    const fileLayer = detectLayer(file, projectDir)
    if (!fileLayer || fileLayer === 'cross-cutting') continue

    const content = readFileSync(file, 'utf-8')
    const imports = extractImports(content)

    for (const imp of imports) {
      if (imp.startsWith('.')) {
        const rel = relative(projectDir, file).replace(/\\/g, '/')
        const parts = imp.replace(/^\.\//, '').split('/')
        const resolved = rel.substring(0, rel.lastIndexOf('/')) + '/' + parts.join('/')
        const normalized = resolved.replace(/\/\.\//g, '/').replace(/[^/]+\/\.\.\//g, '')
        const target = resolveImportTarget(normalized)
        if (target && target.type === 'layer') {
          const rule = LAYER_RULES.find(r => r.layer === fileLayer)
          if (rule && rule.forbidden.includes(target.layer)) {
            violations.push(`${rel}: ${fileLayer} layer imports ${target.layer} layer (${imp})`)
          }
        }
        continue
      }
      const violation = checkForbidden(imp, fileLayer)
      if (violation) {
        const relPath = relative(projectDir, file)
        violations.push(`${relPath}: ${violation} (${imp})`)
      }
    }
  }

  if (violations.length > 0) {
    console.error(`[check-layers] ${violations.length} layer dependency violations:`)
    for (const v of violations.slice(0, 10)) console.error(`  - ${v}`)
    if (violations.length > 10) console.error(`  ... and ${violations.length - 10} more`)
  }

  return { exitCode: 0, violations: violations.length, details: violations }
}

if (process.argv[1]?.endsWith('check-layers.mjs')) {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.env.CODEX_PROJECT_DIR || process.env.OPENCODE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd()
  const r = checkLayers(dir)
  if (r.violations === 0) console.log('[check-layers] layer dependencies correct')
  process.exit(0)
}