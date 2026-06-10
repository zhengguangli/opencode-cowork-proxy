# QUALITY_SCORE

## 品味不变量

### 自动检查规则

以下规则由 `.claude/skills/architecture-guard/scripts/` 目录下的 4 个脚本自动检查：

| 检查项 | 脚本 | 阈值 |
|--------|------|------|
| 文件大小 | `check-file-size.mjs` | 多数 ≤300 行，流翻译器 ≤450 行 |
| 命名约定 | `check-naming.mjs` | 文件名使用 kebab-case + 有意义的后缀 |
| 类型安全 | `check-type-safety.mjs` | `as Record<string, unknown>` = 0（业务代码） |
| 依赖方向 | `check-layers.mjs` | 单向依赖：config → routing → index → handlers → request → translate |

### 文件大小标准

| 分类 | 上限 | 说明 |
|------|------|------|
| Handler 文件 | 160 行 | handler = I/O 编排 + 翻译器调用 |
| 翻译器（非流） | 300 行 | 纯函数 payload 变换 |
| 翻译器（流） | 450 行 | 状态机 + 闭包耦合 |
| 共享辅助 | 50 行 | 单一职责函数 |
| 测试文件 | 500 行 | 每个文件测试一个领域 |
| 配置文件 | 100 行 | 仅常量和注释 |
| 文档 | 350 行 | 目录/README 可略长 |

超过上限的文件需提供注释说明原因。

### 类型安全标准

**严格禁止（业务代码）：**
- `as Record<string, unknown>` — 必须替换为 `asRecord()` / `asRecordArray()` / `asRecordOptional()`
- `as any` — 零容忍
- `as unknown as X` — 零容忍

**允许（带注释）：**
- 类型守卫文件本身（`type-guards.ts` 内部使用 `as` 实现守卫函数）
- 测试代码中的 `as`（但推荐使用显式类型标注）
- Stream controller / Transformer 构造（API 强制类型签名）

### 命名规范

| 文件类型 | 模式 | 示例 |
|----------|------|------|
| 源文件 | `kebab-case.ts` | `think-tag-stripper.ts` |
| 测试文件 | `kebab-case.test.ts` | `responses-api.test.ts` |
| Handler | `handlers/<noun>.ts` | `handlers/messages.ts` |
| 翻译器 | `translate/{direction}/<format>-to-<format>.ts` | `translate/request/anthropic-to-openai.ts` |
| 共享工具 | `translate/{direction}/<tool-name>.ts` | `translate/stream/sse-encoder.ts` |
| 根级模块 | `camel-name.ts` | `config.ts`, `routing.ts` |

### 日志规范

| 环境 | 允许 | 禁止 |
|------|------|------|
| 生产 | `console.log`/`console.error` 仅在 `IS_DEBUG` 保护下 | 裸 `console.log` |
| 调试 | `console.log(...)` 带 `[PREFIX]` 标签 | 无标签的裸输出 |

**IS_DEBUG 模式格式：**
```typescript
if (IS_DEBUG) console.log(`[SOME_CONTEXT] message ${value}`);
```

---

## 代码约定

### 函数风格

1. **纯函数优先：** 无副作用、无 I/O、可预测的输出
2. **显式参数：** 避免隐式全局依赖（如 `process.env`），通过参数传入
3. **单一返回点：** 避免提前 return 的混乱，但 guard clause 允许
4. **Result 类型：** 需要返回错误状态的函数使用 `{ ok: true, data } | { ok: false, response }` 模式

### 导入顺序

```
1. 第三方库 (hono, vitest)
2. 项目内模块 (相对路径)
3. 类型/接口
```

### 注释规范

1. **"WHEN TO READ THIS FILE" 头注释：** 每个源文件顶部必须包含一段描述该文件何时被阅读的注释。示例：
   ```
   /**
    * URL-based routing: path prefix parsing, upstream resolution, model segment extraction.
    *
    * WHEN TO READ THIS FILE: Adding a new path prefix, changing upstream resolution
    * logic, or debugging model-override-from-URL behavior.
    */
   ```
2. **函数 JSDoc：** 公开函数应有 `@param` 和 `@returns` 说明
3. **关键逻辑注释：** 复杂翻译逻辑、状态机、排序约束必须附原因说明
4. **不要注释显而易见的事：** `const x = 5; // set x to 5` 是噪音

---

## 架构约束

### 依赖方向（不可逆）

```
config.ts → routing.ts → index.ts → handlers/ → request.ts → translate/
                                  ↑                        ↓
                                vision.ts               auth.ts
                                  ↓                        ↓
                              config.ts               config.ts
```

- `config.ts` 可被任何模块引用（最底层）
- `request.ts` 可引用 `auth.ts` 和 `config.ts`
- `translate/` 不可引用 `handlers/`、`index.ts`、`routing.ts`
- `vision.ts` 只引用 `config.ts`
- `cache.ts` 只引用 `translate/type-guards.ts`

### 跨切面关注点

认证、fetch、超时、压缩、错误转发通过 `request.ts` 进入。其他模块不应直接执行 fetch 或认证。

**允许的例外：**
- `handlers/` 通过调用 `request.ts` 的 `authenticateRequest()` 和 `safeUpstreamFetch()` 间接执行 fetch/auth
- stream 翻译器不通过 `request.ts` fetch（直接操作 `ReadableStream`）

---

## 测试规范

### 测试文件组织

- 纯翻译器测试：不需要 mock，构造输入 → 断言输出
- 集成测试（handler + fetch）：`vi.spyOn(globalThis, 'fetch')`
- 每个测试文件聚焦一个领域（见 DESIGN.md §测试策略）

### 断言样式

```typescript
// ✅ 推荐：显式断言
expect(result.id).toBe("msg_123");
expect(result.content).toHaveLength(1);
expect(result.content[0]).toMatchObject({ type: "text" });

// ❌ 不推荐：toMatchSnapshot（脆弱）
// ❌ 不推荐：toString() 比较（字节级依赖）
```

### 测试命名

```typescript
describe('function/area name', () => {
  it('should [expected behavior] when [condition/scenario]', () => { ... });
});
```

示例：
```typescript
describe('formatAnthropicToOpenAI', () => {
  it('should extract content as string when single text block', () => { ... });
  it('should handle empty messages array', () => { ... });
});
```

---

## 知识库维护

### 源文件覆盖率

所有 `src/` 源文件必须包含 "WHEN TO READ THIS FILE" 头注释。当前覆盖率：**94%**（30/32 文件）。

目标：**100%**。

### 文档目录

`docs/` 下的每个文档文件应按顺序阅读：

1. `CLAUDE.md` — 项目入口 + harness 体系 + 常见陷阱
2. `docs/ARCHITECTURE.md` — 分层架构 + 路由机制 + 部署
3. `docs/DESIGN.md` — 设计哲学 + 核心决策
4. `docs/SECURITY.md` — 安全策略
5. `docs/QUALITY_SCORE.md` — 质量约束 + 代码规范

---

## 质量指标

| 指标 | 当前值 | 目标 |
|------|--------|------|
| 测试通过率 | 100%（390/390） | 100% |
| `as Record<string, unknown>`（业务代码） | 0 | 0 |
| 文件大小（≥300 行） | 2（流翻译器） | 0 |
| "WHEN TO READ" 覆盖率 | 94% | 100% |
| 空文档 | 0 | 0 |
| console.log（无 IS_DEBUG 保护） | 0 | 0 |
