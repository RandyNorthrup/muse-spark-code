// M96 lease invariants and named regressions from both lane-B reviews.
import { describe, expect, it } from 'vitest'
import {
  defaultResourceKind,
  ResourceRegistry,
  type LeaseHolder,
  type LeaseToken,
  type CallToken,
  repositoryResourceSchema,
  resourceDeclarationSchema,
  type ToolCallBinding,
} from '../../src/core/team/resources'
import { UI_TEXT } from '../../src/shared/constants'
import { ENGINEER, ORCHESTRATOR, RESEARCHER } from './helpers/teamHolders'

function drivenRegistry(windowId = 'test-window') {
  return {
    registry: new ResourceRegistry({
      windowId,
      waitMs: 60_000,
      idleMs: 120_000,
    }),
  }
}

async function held(
  registry: ResourceRegistry,
  name = 'chrome',
  holder: LeaseHolder = RESEARCHER,
): Promise<LeaseToken> {
  const outcome = await registry.acquire(name, holder)
  if (outcome.status !== 'held') throw new Error(outcome.status)
  return outcome.lease
}

async function call(
  registry: ResourceRegistry,
  id: string,
  holder: LeaseHolder = RESEARCHER,
  name = 'chrome',
): Promise<CallToken> {
  const outcome = await registry.acquireCall(
    name,
    holder,
    holder.taskId,
    id,
    new AbortController().signal,
  )
  if (outcome.status !== 'held') throw new Error(outcome.status)
  expect(registry.dispatch(outcome.call)).toBeInstanceOf(AbortSignal)
  return outcome.call
}

function chrome() {
  const driven = drivenRegistry()
  driven.registry.ensureServer('chrome', { command: 'chrome-control-mcp' })
  return driven
}

describe('defaultResourceKind', () => {
  it('marks browser control, Playwright and device servers exclusive', () => {
    expect(defaultResourceKind({ command: 'chrome-control-mcp' })).toBe('exclusive')
    expect(defaultResourceKind({ command: String.raw`C:\tools\mcp-chrome.exe --port 1` })).toBe(
      'exclusive',
    )
    expect(defaultResourceKind({ command: 'npx @scope/mcp-server-playwright' })).toBe('exclusive')
    expect(defaultResourceKind({ packageName: '@modelcontextprotocol/server-puppeteer' })).toBe(
      'exclusive',
    )
    expect(defaultResourceKind({ command: 'serial-device-server' })).toBe('exclusive')
    expect(defaultResourceKind({ command: 'C:/bin/adb-mcp' })).toBe('exclusive')
  })

  it('leaves unknown servers shared', () => {
    expect(defaultResourceKind({ command: 'my-notes-server' })).toBe('shared')
    expect(defaultResourceKind({})).toBe('shared')
  })
})

describe('command patterns', () => {
  it('matches a declared command and its arguments, and nothing else', () => {
    const { registry } = drivenRegistry()
    registry.declareCommandNeed('npm run dev', 'port:3000')
    expect(registry.resourceForCommand('npm run dev')).toBe('port:3000')
    expect(registry.resourceForCommand('npm run dev -- --port 3000')).toBe('port:3000')
    expect(registry.resourceForCommand('npm run deve')).toBeUndefined()
    expect(registry.resourceForCommand('npm run build')).toBeUndefined()
  })
})

describe('exclusive leases', () => {
  it('runs one task, queues the other with the holder named, then runs it', async () => {
    const { registry } = chrome()
    const first = await held(registry)
    const waiting = registry.acquire('chrome', ENGINEER)
    expect(registry.snapshot()).toEqual([
      { name: 'chrome', kind: 'exclusive', holders: [RESEARCHER], waiters: [ENGINEER] },
    ])
    registry.release(first)
    await expect(waiting).resolves.toMatchObject({ status: 'held' })
    expect(registry.checkCall('chrome', ENGINEER)).toEqual({ status: 'ok' })
  })

  it('re-admits the same holder with the same lease identity', async () => {
    const { registry } = chrome()
    const first = await held(registry)
    expect(await held(registry)).toEqual(first)
    expect(first).toMatchObject({
      windowId: 'test-window',
      resourceName: 'chrome',
      holder: RESEARCHER,
      generation: 1,
    })
  })

  it('requires its exact lease id, generation, window and server for release', async () => {
    const { registry } = chrome()
    const token = await held(registry)
    for (const wrong of [
      { ...token, id: 'other' },
      { ...token, generation: 2 },
      { ...token, windowId: 'other' },
      { ...token, resourceName: 'other' },
      { ...token, holder: { ...token.holder, taskId: 'other' } },
      { ...token, holder: { ...token.holder, attempt: 2 } },
    ]) {
      registry.release(wrong)
      expect(registry.snapshot()[0]?.holders).toEqual([RESEARCHER])
    }
    registry.release(token)
    expect(registry.snapshot()[0]?.holders).toEqual([])
  })

  it('does not let a different window settle or release its ownership', async () => {
    const first = chrome().registry
    const second = drivenRegistry('other-window').registry
    second.ensureServer('chrome', { command: 'chrome-control-mcp' })
    const a = await call(first, 'same')
    const b = await call(second, 'same')
    second.settle(a, 'answered')
    second.release(a.lease)
    second.release(b.lease)
    expect(second.snapshot()[0]?.holders).toEqual([RESEARCHER])
    second.settle(b, 'answered')
    expect(second.snapshot()[0]?.holders).toEqual([])
  })

  it('keeps lease ids unique across registry replacements in the same window', async () => {
    const first = chrome().registry
    const second = chrome().registry
    const old = await call(first, 'same')
    const fresh = await call(second, 'same')
    expect(fresh.lease.id).not.toBe(old.lease.id)
    second.settle(old, 'answered')
    second.release(old.lease)
    second.release(fresh.lease)
    expect(second.snapshot()[0]?.holders).toEqual([RESEARCHER])
    second.settle(fresh, 'answered')
    expect(second.snapshot()[0]?.holders).toEqual([])
  })
})

describe('idle release and call identity', () => {
  it('client cancellation snapshots call identities before an abort listener re-enters', async () => {
    const { registry } = drivenRegistry()
    registry.declare({ name: 'notes', kind: 'shared', sharedLimit: 2 })
    const old = await registry.acquireCall(
      'notes',
      RESEARCHER,
      'client',
      'old',
      new AbortController().signal,
    )
    if (old.status !== 'held') throw new Error(old.status)
    const oldSignal = registry.dispatch(old.call)
    let reentry: ReturnType<ResourceRegistry['acquireCall']> | undefined
    oldSignal?.addEventListener(
      'abort',
      () => {
        reentry = registry.acquireCall(
          'notes',
          RESEARCHER,
          'client',
          'new',
          new AbortController().signal,
        )
      },
      { once: true },
    )
    registry.cancelClient('client')
    const fresh = await reentry
    expect(fresh?.status).toBe('held')
    if (fresh?.status !== 'held') throw new Error('re-entry was cancelled')
    const freshSignal = registry.dispatch(fresh.call)
    expect(freshSignal?.aborted).toBe(false)
    registry.settle(old.call, 'answered')
    expect(freshSignal?.aborted).toBe(false)
    registry.settle(fresh.call, 'failed')
  })
})

describe('retirement and take back', () => {
  it('releases a stopped attempt and refuses its late call by attempt number', async () => {
    const { registry } = chrome()
    await held(registry)
    registry.retireAttempt('task-a', 1)
    await expect(registry.acquire('chrome', ENGINEER)).resolves.toMatchObject({ status: 'held' })
    await expect(registry.acquire('chrome', RESEARCHER)).resolves.toEqual({ status: 'stale' })
  })

  it('hears a waiter retired while waiting at once', async () => {
    const { registry } = chrome()
    await held(registry)
    const waiting = registry.acquire('chrome', ENGINEER)
    registry.retireAttempt('task-b', 1)
    await expect(waiting).resolves.toEqual({ status: 'stale' })
  })

  it.each(['exit', 'release-anyway'])(
    'ends pending Take back only on explicit %s',
    async (action) => {
      const { registry } = chrome()
      await call(registry, 'open')
      registry.takeBack('chrome', ORCHESTRATOR)
      if (action === 'exit') registry.markServerExited('chrome')
      else registry.releaseAnyway('chrome')
      expect(registry.snapshot()[0]?.holders).toEqual([ORCHESTRATOR])
    },
  )

  it('moves an idle lease to the orchestrator and tells the old holder busy', async () => {
    const { registry } = chrome()
    await held(registry)
    registry.takeBack('chrome', ORCHESTRATOR)
    expect(registry.checkCall('chrome', RESEARCHER)).toEqual({
      status: 'taken-back',
      holder: ORCHESTRATOR,
    })
    expect(registry.checkCall('chrome', ORCHESTRATOR)).toEqual({ status: 'ok' })
  })
})

describe('the repository file', () => {
  it.each([-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])(
    'RVM96B3-2: refuses invalid shared limit %s at both declaration boundaries and application',
    async (sharedLimit) => {
      const { registry } = drivenRegistry()
      registry.declare({ name: 'notes', kind: 'shared', sharedLimit: 2 })
      expect(repositoryResourceSchema.safeParse({ name: 'notes', sharedLimit }).success).toBe(false)
      expect(
        resourceDeclarationSchema.safeParse({ name: 'notes', kind: 'shared', sharedLimit }).success,
      ).toBe(false)
      expect(() => registry.declare({ name: 'notes', kind: 'shared', sharedLimit })).toThrow()
      const result = registry.applyRepositoryResources([{ name: 'notes', sharedLimit }])
      expect(result.accepted).toEqual([])
      expect(result.refused).toEqual([{ name: 'notes', reason: 'invalid shared limit' }])
      expect(registry.list()[0]?.sharedLimit).toBe(2)
      const admitted = await call(registry, 'still-available', RESEARCHER, 'notes')
      registry.settle(admitted, 'answered')
    },
  )

  it('RVM96B3-2: accepts positive safe integer limits and valid repository lowering', async () => {
    for (const sharedLimit of [1, 2, Number.MAX_SAFE_INTEGER]) {
      expect(repositoryResourceSchema.safeParse({ name: 'notes', sharedLimit }).success).toBe(true)
      expect(
        resourceDeclarationSchema.safeParse({ name: 'notes', kind: 'shared', sharedLimit }).success,
      ).toBe(true)
    }
    const { registry } = drivenRegistry()
    registry.declare({ name: 'notes', kind: 'shared', sharedLimit: 2 })
    const entry = repositoryResourceSchema.parse({ name: 'notes', sharedLimit: 1 })
    expect(registry.applyRepositoryResources([entry])).toEqual({ accepted: ['notes'], refused: [] })
    const admitted = await call(registry, 'lowered', RESEARCHER, 'notes')
    registry.settle(admitted, 'answered')
  })

  it('lowers but never frees, loosens or raises', () => {
    const { registry } = drivenRegistry()
    registry.declare({ name: 'gpu', kind: 'shared', sharedLimit: 4 })
    registry.declare({ name: 'chrome', kind: 'exclusive' })
    const lowered = registry.applyRepositoryResources([{ name: 'gpu', sharedLimit: 2 }])
    expect(lowered).toEqual({ accepted: ['gpu'], refused: [] })
    const refused = registry.applyRepositoryResources([
      { name: 'gpu', kind: 'free' },
      { name: 'gpu', sharedLimit: 8 },
      { name: 'chrome', kind: 'shared' },
      { name: 'missing', kind: 'exclusive' },
    ])
    expect(refused.accepted).toEqual([])
    expect(refused.refused.map((entry) => entry.name)).toEqual(['gpu', 'gpu', 'chrome', 'missing'])
    expect(registry.list().find((entry) => entry.name === 'gpu')?.sharedLimit).toBe(2)
  })
})

describe('roles and kinds', () => {
  it.each([
    { changed: 'server', patch: { server: 'notes' } },
    { changed: 'catalogue generation', patch: { catalogueGeneration: 2 } },
    { changed: 'tool', patch: { tool: 'write' } },
    { changed: 'permission class', patch: { isReadOnly: false } },
    { changed: 'removed tool', patch: undefined },
    { changed: 'assignment', patch: {} },
    { changed: 'lease resource', patch: {} },
    { changed: 'released lease', patch: {} },
  ])(
    'RVM96B3-1: registry abandons admission after changed $changed',
    async ({ changed, patch }) => {
      const { registry } = chrome()
      const binding: ToolCallBinding = {
        server: changed === 'lease resource' ? 'notes' : 'chrome',
        catalogueGeneration: 1,
        tool: 'read',
        isReadOnly: true,
      }
      const admission = await registry.acquireCall(
        'chrome',
        RESEARCHER,
        'reader',
        'binding',
        new AbortController().signal,
        {
          binding,
          resolve: () => (patch === undefined ? undefined : { ...binding, ...patch }),
          allowedServers: () => (changed === 'assignment' ? [] : ['chrome', 'notes']),
        },
      )
      if (admission.status !== 'held') throw new Error(admission.status)
      if (changed === 'released lease') registry.release(admission.call.lease)
      expect(registry.dispatch(admission.call)).toBeUndefined()
      expect(admission.signal.reason).toBe(UI_TEXT.teamToolBindingChanged)
      expect(registry.snapshot()[0]?.holders).toEqual([])
      expect(registry.snapshot()[0]?.waiters).toEqual([])
      const replacement = await call(registry, 'after-refusal', ENGINEER)
      registry.settle(replacement, 'answered')
    },
  )

  it('RVM96A-11: offers unassigned servers to no role and assigned servers only to their roles', () => {
    const { registry } = drivenRegistry()
    registry.declare({ name: 'chrome', kind: 'exclusive' })
    registry.declare({ name: 'device', kind: 'exclusive', assignedRoles: ['engineering'] })
    registry.ensureServer('notes')
    expect(registry.serversForRole('research')).toEqual([])
    expect(registry.serversForRole('new-project-role')).toEqual([])
    expect(registry.serversForRole('engineering')).toEqual(['device'])
  })

  it('holds no exclusive capacity for a free resource', async () => {
    const { registry } = drivenRegistry()
    registry.declare({ name: 'clock', kind: 'free' })
    await call(registry, 'one', RESEARCHER, 'clock')
    await call(registry, 'two', ENGINEER, 'clock')
    expect(registry.checkCall('clock', ENGINEER)).toEqual({ status: 'ok' })
    expect(registry.snapshot()).toEqual([{ name: 'clock', kind: 'free', holders: [], waiters: [] }])
  })

  it('RVM96RB2-7: shared capacity counts concurrent calls, including same-holder re-entry', async () => {
    const { registry } = drivenRegistry()
    registry.declare({ name: 'notes', kind: 'shared', sharedLimit: 2 })
    const first = await call(registry, 'one', RESEARCHER, 'notes')
    const second = await call(registry, 'two', RESEARCHER, 'notes')
    const third = registry.acquireCall(
      'notes',
      RESEARCHER,
      'task-a',
      'three',
      new AbortController().signal,
    )
    const fourth = registry.acquireCall(
      'notes',
      ENGINEER,
      'task-b',
      'four',
      new AbortController().signal,
    )
    expect(registry.snapshot()[0]?.waiters).toEqual([RESEARCHER, ENGINEER])
    registry.settle(first, 'answered')
    const admitted = await third
    expect(admitted.status).toBe('held')
    expect(registry.snapshot()[0]?.waiters).toEqual([ENGINEER])
    registry.settle(second, 'failed')
    await expect(fourth).resolves.toMatchObject({ status: 'held' })
  })
})

describe('the hint question', () => {
  it('names the other window running an exclusive server, and nothing else', () => {
    const { registry } = drivenRegistry()
    registry.declare({ name: 'chrome', kind: 'exclusive' })
    registry.declare({ name: 'gpu', kind: 'shared' })
    const hints = [{ windowLabel: 'window A', exclusiveServers: ['chrome'] }]
    expect(registry.externalUserOf('chrome', hints)).toBe('window A')
    expect(registry.externalUserOf('chrome', [])).toBeUndefined()
    expect(registry.externalUserOf('gpu', hints)).toBeUndefined()
    expect(registry.externalUserOf('unknown', hints)).toBeUndefined()
  })
})

describe('declaration errors', () => {
  it('refuses an empty name and a limit below 1', () => {
    const { registry } = drivenRegistry()
    expect(() => registry.declare({ name: '', kind: 'free' })).toThrow()
    expect(() => registry.declare({ name: 'gpu', kind: 'shared', sharedLimit: 0 })).toThrow()
    expect(() => {
      registry.declareCommandNeed('  ', 'port:3000')
    }).toThrow()
  })
})
