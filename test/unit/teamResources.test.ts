// M96 lease invariants and named regressions from both lane-B reviews.
import { describe, expect, it } from 'vitest'
import {
  busyText,
  defaultResourceKind,
  ResourceRegistry,
  type LeaseHolder,
  type LeaseToken,
  type CallToken,
  repositoryResourceSchema,
  resourceDeclarationSchema,
} from '../../src/core/team/resources'
import { createManualClock } from './helpers/manualClock'
import { ENGINEER, ORCHESTRATOR, RESEARCHER } from './helpers/teamHolders'

function drivenRegistry(windowId = 'test-window') {
  const driven = createManualClock()
  return {
    ...driven,
    registry: new ResourceRegistry({
      windowId,
      clock: driven.clock,
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

function expectIdleBoundary(registry: ResourceRegistry, advance: (ms: number) => void): void {
  advance(119_999)
  expect(registry.snapshot()[0]?.holders).toEqual([RESEARCHER])
  advance(1)
  expect(registry.snapshot()[0]?.holders).toEqual([])
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

  it('holds a command resource until its process exits, never on idleness', async () => {
    const { registry, advance } = drivenRegistry()
    registry.declareCommandNeed('npm run dev', 'port:3000')
    const token = await call(registry, 'command', RESEARCHER, 'port:3000')
    registry.settle(token, 'answered')
    advance(1_000_000)
    expect(registry.checkCall('port:3000', ENGINEER)).toMatchObject({
      status: 'not-holder',
      holder: RESEARCHER,
    })
    registry.release(token.lease)
    expect(registry.snapshot()[0]?.holders).toEqual([])
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

  it('answers resource busy past the wait, naming the holder', async () => {
    const { registry, advance } = chrome()
    await held(registry)
    const waiting = registry.acquire('chrome', ENGINEER)
    advance(60_000)
    await expect(waiting).resolves.toEqual({ status: 'busy', holder: RESEARCHER })
    expect(busyText(RESEARCHER)).toBe('resource busy, held by research task task-a')
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

  it('settles only dispatched records and dispatches each call once without cancelling its first dispatch', async () => {
    const { registry, advance } = chrome()
    const outcome = await registry.acquireCall(
      'chrome',
      RESEARCHER,
      'client',
      'one',
      new AbortController().signal,
    )
    if (outcome.status !== 'held') throw new Error(outcome.status)
    registry.settle(outcome.call, 'answered')
    advance(120_000)
    expect(registry.snapshot()[0]?.holders).toEqual([RESEARCHER])
    const signal = registry.dispatch(outcome.call)
    expect(signal?.aborted).toBe(false)
    expect(registry.dispatch(outcome.call)).toBeUndefined()
    expect(signal?.aborted).toBe(false)
    registry.settle(outcome.call, 'failed')
    advance(120_000)
    expect(registry.snapshot()[0]?.holders).toEqual([])
  })
  it('releases only after the idle time from the last terminal answer', async () => {
    const { registry, advance } = chrome()
    const token = await call(registry, 'one')
    registry.settle(token, 'answered')
    expectIdleBoundary(registry, advance)
  })

  it('keeps the lease for a call longer than the idle time', async () => {
    const { registry, advance } = chrome()
    const token = await call(registry, 'long')
    advance(1_000_000)
    expect(registry.snapshot()[0]?.holders).toEqual([RESEARCHER])
    registry.settle(token, 'answered')
    advance(120_000)
    expect(registry.snapshot()[0]?.holders).toEqual([])
  })

  it('keeps a cancelled dispatched call until its own terminal answer', async () => {
    const { registry, advance } = chrome()
    const token = await call(registry, 'cancelled')
    registry.cancelCall(token)
    advance(1_000_000)
    expect(registry.snapshot()[0]?.holders).toEqual([RESEARCHER])
    registry.settle(token, 'answered')
    expectIdleBoundary(registry, advance)
  })

  it('cannot settle another call by replaying a completion', async () => {
    const { registry, advance } = chrome()
    const first = await call(registry, 'first')
    const second = await call(registry, 'second')
    registry.settle(first, 'answered')
    registry.settle(first, 'answered')
    registry.release(first.lease)
    advance(1_000_000)
    expect(registry.snapshot()[0]?.holders).toEqual([RESEARCHER])
    registry.settle(second, 'failed')
    expect(registry.snapshot()[0]?.holders).toEqual([])
  })

  it.each(['exit', 'release-anyway'])(
    'RVM96RB2-4: ignores old completion and release after replacement by %s',
    async (action) => {
      const { registry, advance } = chrome()
      const old = await call(registry, 'old')
      if (action === 'exit') registry.markServerExited('chrome')
      else registry.releaseAnyway('chrome')
      const replacement = await call(registry, 'new')
      expect(replacement.lease.id).not.toBe(old.lease.id)
      expect(replacement.lease.generation).toBeGreaterThan(old.lease.generation)
      registry.settle(old, 'answered')
      registry.release(old.lease)
      advance(1_000_000)
      expect(registry.snapshot()[0]?.holders).toEqual([RESEARCHER])
      registry.settle(replacement, 'answered')
      advance(120_000)
      expect(registry.snapshot()[0]?.holders).toEqual([])
    },
  )
})

describe('retirement and take back', () => {
  it.each(['retire', 'take-back'])(
    'RVM96A-9: %s retains every dispatched call and refuses new calls',
    async (action) => {
      const { registry, advance } = chrome()
      const first = await call(registry, 'first')
      const second = await call(registry, 'second')
      registry.cancelCall(first)
      if (action === 'retire') registry.retireAttempt(RESEARCHER.taskId, 1)
      else registry.takeBack('chrome', ORCHESTRATOR)
      expect(registry.checkCall('chrome', RESEARCHER).status).toBe(
        action === 'retire' ? 'stale-attempt' : 'taken-back',
      )
      registry.settle(first, 'answered')
      advance(1_000_000)
      expect(registry.snapshot()[0]?.holders).toEqual([RESEARCHER])
      registry.settle(second, 'failed')
      expect(registry.snapshot()[0]?.holders).toEqual(action === 'retire' ? [] : [ORCHESTRATOR])
    },
  )

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

  it('times out a pending Take back admission without transferring an open lease', async () => {
    const { registry, advance } = chrome()
    const token = await call(registry, 'open')
    registry.takeBack('chrome', ORCHESTRATOR)
    const waiting = registry.acquire('chrome', ORCHESTRATOR)
    advance(60_000)
    await expect(waiting).resolves.toEqual({ status: 'busy', holder: RESEARCHER })
    registry.settle(token, 'answered')
    expect(registry.snapshot()[0]?.holders).toEqual([ORCHESTRATOR])
    expect(busyText(ORCHESTRATOR)).toBe('resource busy, held by orchestrator task main')
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

  it('pending admissions pin leases and reserve shared slots before dispatch', async () => {
    const { registry, advance } = drivenRegistry()
    registry.declare({ name: 'notes', kind: 'shared', sharedLimit: 1 })
    const pending = await registry.acquireCall(
      'notes',
      RESEARCHER,
      'a',
      '1',
      new AbortController().signal,
    )
    if (pending.status !== 'held') throw new Error(pending.status)
    const waiting = registry.acquireCall('notes', ENGINEER, 'b', '2', new AbortController().signal)
    registry.release(pending.call.lease)
    advance(120_000)
    // Releasing a pending admission abandons it; it never dispatches or settles another call.
    expect(registry.dispatch(pending.call)).toBeUndefined()
    await expect(waiting).resolves.toMatchObject({ status: 'held' })
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

describe('closing', () => {
  it('stops timers and tells every waiter, while retaining dispatched uncertainty', async () => {
    const { registry, advance } = chrome()
    const first = await call(registry, 'open')
    const waiting = registry.acquire('chrome', ENGINEER)
    registry.close()
    await expect(waiting).resolves.toEqual({ status: 'closed' })
    await expect(registry.acquire('chrome', ENGINEER)).resolves.toEqual({ status: 'closed' })
    advance(1_000_000)
    expect(registry.snapshot()[0]?.holders).toEqual([RESEARCHER])
    registry.settle(first, 'answered')
    expect(registry.snapshot()[0]?.holders).toEqual([])
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
