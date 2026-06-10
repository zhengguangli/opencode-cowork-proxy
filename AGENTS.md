<!-- HARNESS-PILOT:START -->

## 架构地图
- 详见 [CLAUDE.md](CLAUDE.md) — 项目主文档和 harness 指针
- Agent 定义：`.claude/agents/` — 7 个专业 agent
- Skill 定义：`.claude/skills/` — 11 个标准技能
- 安装脚本：`scripts/install.mjs` — 统一安装器

## 关键约束
- **人类掌舵，智能体执行** — 工程师设计环境，AI 执行代码
- **仓库即记录系统** — 仓库外的知识对智能体不存在
- **给地图，不给说明书** — AGENTS.md 是目录，不是百科全书
- **约束即加速器** — 严格的架构边界是倍增器

## Agent 团队

| Agent | 职责 |
|-------|------|
| orchestrator | 团队协调者，管理任务分派和阶段流转 |
| architect | 架构设计师，定义分层边界和品味不变量 |
| builder | 代码生成器，在约束内生成实现代码 |
| reviewer | 质量审查员，代码审查和品味校验 |
| qa | 验证工程师，测试和触发检查 |
| sre | 站点可靠性工程师，可观测性和熵管理 |
| context-engineer | 上下文工程师，知识库架构管理 |

## 技能包

| Skill | 用途 |
|-------|------|
| harness-orchestrator | 团队编排器，协调所有 agent 执行 |
| harness-init | 一键初始化 harness |
| context-setup | 知识库架构生成 |
| architecture-guard | 架构边界强制执行 |
| entropy-gc | 熵管理与垃圾收集 |
| observability-setup | 可观测性堆栈配置 |
| sandbox-exec | 安全代码执行环境 |
| quality-gate | 质量审查门禁 |
| agent-readability | 智能体可读性优化 |
| harness-evolve | 反馈驱动演进 |
| hooks-framework | 确定性执行钩子 |

## 导航指引
- 新项目初始化？使用 `harness-init` 或 `harness-orchestrator` skill
- 架构设计？读 `.claude/agents/architect.md`
- 质量审查？读 `.claude/skills/quality-gate/SKILL.md`
- 知识库管理？读 `.claude/skills/context-setup/SKILL.md`
- 演进反馈？读 `.claude/skills/harness-evolve/SKILL.md`
- Hooks 配置？读 `.claude/skills/hooks-framework/SKILL.md`
- 安装部署？读 `README.md` 或运行 `node scripts/install.mjs --help`

<!-- HARNESS-PILOT:END -->
