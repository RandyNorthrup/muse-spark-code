// M91 lane W: Cursor's command pattern is matched under a deadline the caller
// can inject, so a test never depends on wall time under load (a 25 ms match
// once lapsed on a busy rig and ran the guard). Production keeps
// HOOK_MATCHER_TIMEOUT_MS. Fake-only: no hook runs.
import { describe, expect, it, vi } from 'vitest'
import { createForeignHookAdapter } from '../../src/core/backends/modelapi/foreignHooksEntry'
import { parseForeignHooks, type HookDefinition } from '../../src/core/backends/modelapi/hooks'
import { HOOK_MATCHER_TIMEOUT_MS } from '../../src/shared/constants'

const { deadlines } = vi.hoisted(() => ({ deadlines: [] as unknown[] }))

vi.mock('../../src/core/backends/modelapi/hooks', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  const real = original['matchingHooks'] as (...args: unknown[]) => unknown
  return {
    ...original,
    matchingHooks: (...args: unknown[]) => {
      deadlines.push(args[4])
      return real(...args)
    },
  }
})

const ROOT = '/ws'

function guard(): HookDefinition {
  const parsed = parseForeignHooks(
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            format: 'cursor',
            sourceEvent: 'beforeShellExecution',
            flavor: 'specialized',
            commandPattern: 'curl',
            hooks: [{ type: 'command', command: './no-network.sh' }],
          },
        ],
      },
    }),
    'project',
    'linux',
  )
  const [hook] = parsed.hooks
  if (hook === undefined) throw new Error(`no hook: ${parsed.warnings.join('; ')}`)
  return hook
}

async function prepareWith(matcherTimeoutMs?: number) {
  deadlines.length = 0
  const adapter = createForeignHookAdapter({
    workspaceRoot: ROOT,
    platform: 'linux',
    io: { realPath: (absolutePath) => Promise.resolve(absolutePath) },
    homeDir: undefined,
    ...(matcherTimeoutMs !== undefined && { matcherTimeoutMs }),
  })
  const hook = guard()
  if (hook.foreign === undefined) throw new Error('not an imported hook')
  return await adapter.prepare(
    hook,
    hook.foreign,
    'PreToolUse',
    {
      hook_event_name: 'PreToolUse',
      cwd: ROOT,
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
    },
    undefined,
  )
}

describe('the command pattern’s match deadline (M91 lane W)', () => {
  it('matches under the injected deadline, and skips a command it does not select', async () => {
    const prepared = await prepareWith(60_000)
    expect(deadlines).toContain(60_000)
    expect(prepared.outcome).toBe('skip')
  })

  it('keeps the production deadline when none is injected', async () => {
    await prepareWith()
    expect(deadlines).toContain(HOOK_MATCHER_TIMEOUT_MS)
    expect(HOOK_MATCHER_TIMEOUT_MS).toBe(25)
  })
})
