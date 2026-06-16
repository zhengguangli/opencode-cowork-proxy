import type { Plugin } from '@opencode/core'

type HookResult = { ok: boolean; message?: string }

type HookFn = (projectDir: string, ...args: string[]) => Promise<HookResult>

async function loadScript(name: string): Promise<HookFn> {
  const mod = await import(`./scripts/${name}.mjs`)
  return mod.default ?? mod[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]
}

async function runHooks(projectDir: string, names: string[], args: string[] = []): Promise<void> {
  for (const name of names) {
    try {
      const fn = await loadScript(name)
      await fn(projectDir, ...args)
    } catch {}
  }
}

export const harnessHooks: Plugin = {
  name: 'harness-hooks',

  async register(events) {
    const dir = process.cwd()

    events.on('session.created', async () => {
      await runHooks(dir, ['context-check', 'env-verify'])
      await runHooks(dir, ['context-cleanup'], ['--seed'])
    })

    events.on('file.edited', async () => {
      await runHooks(dir, ['lint-check', 'context-cleanup'])
    })

    events.on('experimental.session.compacting', async () => {
      await runHooks(dir, ['compaction'])
    })

    events.on('session.idle', async () => {
      await runHooks(dir, ['continuation', 'trace-log', 'todo-sync', 'quality-metric'])
    })
  },
}
