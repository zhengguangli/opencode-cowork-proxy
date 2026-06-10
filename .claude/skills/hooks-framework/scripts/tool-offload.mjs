import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, basename } from 'path'

const OFFLOAD_THRESHOLD = 2000 // 超过 2000 字符时卸载
const HEAD_LINES = 20 // 保留头部行数
const TAIL_LINES = 10 // 保留尾部行数

export function toolOffload(projectDir, toolOutput, toolName = 'unknown') {
  const ws = join(projectDir, '.workspace')
  const offloadDir = join(ws, 'offloaded')
  try { mkdirSync(offloadDir, { recursive: true }) } catch {}

  // 如果输出为空或未超过阈值，直接返回原内容
  if (!toolOutput || toolOutput.length <= OFFLOAD_THRESHOLD) {
    return { offloaded: false, content: toolOutput }
  }

  // 生成唯一文件名
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safeName = toolName.replace(/[^a-zA-Z0-9]/g, '_')
  const filename = `${safeName}_${timestamp}.txt`
  const filePath = join(offloadDir, filename)

  // 写入完整内容到文件系统
  writeFileSync(filePath, toolOutput, 'utf-8')

  // 生成摘要：保留首尾部分
  const lines = toolOutput.split('\n')
  const head = lines.slice(0, HEAD_LINES).join('\n')
  const tail = lines.slice(-TAIL_LINES).join('\n')
  const omitted = Math.max(0, lines.length - HEAD_LINES - TAIL_LINES)

  const summary = omitted > 0 
    ? `${head}\n\n... [省略 ${omitted} 行，完整内容已卸载到文件系统] ...\n\n${tail}`
    : `${head}\n\n${tail}`

  // 生成引用信息
  const reference = `## 工具输出卸载

**工具:** ${toolName}
**原始大小:** ${(toolOutput.length / 1024).toFixed(1)}KB (${lines.length} 行)
**卸载文件:** \`${filePath}\`
**阈值:** ${OFFLOAD_THRESHOLD} 字符

### 摘要（首尾 ${HEAD_LINES + TAIL_LINES} 行）

${summary}

> 完整内容可通过 \`cat ${filePath}\` 查看`

  // 保存引用文件
  const refFilename = `${safeName}_${timestamp}_ref.md`
  const refPath = join(offloadDir, refFilename)
  writeFileSync(refPath, reference, 'utf-8')

  console.log(`[tool-offload] 已卸载 ${toolName} 输出 (${(toolOutput.length / 1024).toFixed(1)}KB) → ${filePath}`)

  return {
    offloaded: true,
    content: summary,
    filePath,
    refPath,
    originalSize: toolOutput.length,
    lineCount: lines.length
  }
}

// CLI 模式：从 stdin 读取 JSON 输入
if (process.argv[1]?.endsWith('tool-offload.mjs')) {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.env.PROJECT_DIR || process.cwd()

  let input = ''
  try {
    input = readFileSync('/dev/stdin', 'utf-8')
  } catch {
    try { input = readFileSync(0, 'utf-8') } catch {}
  }

  try {
    const data = JSON.parse(input)
    const { tool_output, tool_name } = data
    const result = toolOffload(dir, tool_output, tool_name)
    console.log(JSON.stringify(result))
  } catch (err) {
    // 如果没有 JSON 输入，使用演示模式
    const demoOutput = 'A'.repeat(5000) // 模拟大型输出
    const result = toolOffload(dir, demoOutput, 'demo')
    console.log(JSON.stringify(result, null, 2))
  }

  process.exit(0)
}
