---
name: architecture-guard
description: 强制执行架构边界和品味不变量。生成 linter 规则、结构测试、CI 检查。当用户说"架构检查"、"边界验证"、"生成 linter"、"architecture guard"、"强制执行架构"、"品味检查"时触发。也用于审查现有代码是否符合架构约束。
---

# Architecture Guard — 架构边界强制执行

## 核心理念

**约束即加速器。** 通过强制执行不变量而非微观管理，让智能体快速交付且不削弱基础。编码一次，全局生效。

## 执行流程

### Step 1: 加载架构规则

从以下来源加载架构约束：
- `docs/ARCHITECTURE.md` — 分层架构定义
- `docs/QUALITY_SCORE.md` — 品味不变量
- `docs/SECURITY.md` — 安全约束

### Step 2: 生成分层 Linter

根据架构定义生成自定义 linter 规则：

**检查项：**
- 依赖方向是否单向（Types → Config → Repo → Service → Runtime → UI）
- 横切关注点是否通过 Providers 接口进入
- 是否存在跨层直接依赖

**错误信息格式：**
```
[ARCHITECTURE_VIOLATION] {文件路径}:{行号}
违反规则：{规则描述}
依赖方向：{当前} → {禁止的目标}
修复指令：将 {具体操作}
```

错误信息必须包含修复指令，可直接注入智能体上下文。

### Step 3: 生成结构测试

```typescript
// architecture.spec.ts
describe('Architecture boundaries', () => {
  it('Types layer cannot depend on Service layer', () => {
    // 检查 types/ 目录下的文件不 import service/ 目录
  });
  
  it('Cross-cutting concerns enter only through Providers', () => {
    // 检查认证、连接器等只通过 Providers 接口访问
  });
});
```

### Step 4: 生成 CI 检查

```yaml
# .github/workflows/architecture-guard.yml
name: Architecture Guard
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run lint:architecture
      - run: npm run test:architecture
```

### Step 5: 品味不变量检查

| 类别 | Linter 规则 |
|------|-------------|
| 结构化日志 | 检测 console.log / print 等非结构化日志 |
| 命名约定 | 验证 Schema/类型命名符合规范 |
| 文件大小 | 超过阈值的文件标记警告 |
| 类型安全 | 检测 any 类型、类型断言、YOLO 式探测 |
| 共享工具 | 检测重复的辅助函数实现 |

### Step 6: 打包检查脚本

将检查规则打包为可独立运行的 .mjs 脚本（Node.js ESM，跨平台）：

```
architecture-guard/
├── SKILL.md
└── scripts/
    ├── check-layers.mjs       ← 依赖方向检查
    ├── check-naming.mjs       ← 命名约定检查
    ├── check-file-size.mjs    ← 文件大小检查
    └── check-type-safety.mjs  ← 类型安全检查（TS/Python/Go/Rust）
```

每个脚本：
- 跨平台：Node.js ESM，macOS/Linux/Windows 通用
- 双模式：CLI（`node scripts/check-layers.mjs`）+ import（`import { checkLayers }`）
- 输入：项目根目录路径（`CLAUDE_PROJECT_DIR` 环境变量或 cwd）
- 输出：违规报告（stderr），始终 exit 0
- 语言感知：自动检测 TS/Python/Go/Rust 并应用对应规则

## 输入/输出协议

**输入：**
- `docs/ARCHITECTURE.md`
- `docs/QUALITY_SCORE.md`
- `docs/SECURITY.md`
- 项目技术栈

**输出：**
- Linter 配置文件
- `scripts/` 目录下的检查脚本
- 结构测试文件
- CI 工作流配置
- `docs/ARCHITECTURE.md` 更新（如需要）

## 质量标准

- 每条 linter 规则包含明确的修复指令
- 每个检查脚本可独立运行（`node scripts/check-*.mjs`）
- 脚本跨平台（Node.js ESM，无外部依赖）
- 结构测试可独立运行
- CI 检查在 PR 时自动触发
