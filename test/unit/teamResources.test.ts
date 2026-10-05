// The shared-resource registry (M96 lane B, PLAN.md D75 acceptances 44): the
// defaults matched by command and package, command patterns, leases with
// holder and attempt, the queue with its wait and "busy", idle release only
// after every call is terminal, Take back, and the hint question.

import { describe, expect, it } from 'vitest'
import { busyText, defaultResourceKind, ResourceRegistry } from '../../src/core/team/resources'
import { createManualClock } from './helpers/manualClock'
import { ENGINEER, ORCHESTRATOR, RESEARCHER } from './helpers/teamHolders'

function drivenRegistry() {
  const driven = createManualClock()
  return {
    ...driven,
    registry: new ResourceRegistry({ clock: driven.clock, waitMs: 60_000, idleMs: 120_000 }),
  }
}

/** The lease tests’ shared setup: an exclusive chrome held by the researcher. */
async function heldChrome(registry: ResourceRegistry): Promise<void> {
  registry.declare({ name: 'chrome', kind: 'exclusive' })
  await registry.acquire('chrome', RESEARCHER)
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
    await expect(registry.acquire('port:3000', RESEARCHER)).resolves.toEqual({ status: 'held' })
    registry.callStarted('port:3000', RESEARCHER)
    registry.callEnded('port:3000', RESEARCHER, true)
    advance(1_000_000)
    // Still held: only the process exit (release) frees it.
    expect(registry.checkCall('port:3000', ENGINEER)).toEqual({
      status: 'not-holder',
      holder: RESEARCHER,
    })
    registry.release('port:3000', RESEARCHER)
    expect(registry.checkCall('port:3000', ENGINEER)).toEqual({
      status: 'not-holder',
      holder: undefined,
    })
  })
})

describe('exclusive leases', () => {
  it('runs one task, queues the other with the holder named, then runs it', async () => {
    const { registry } = drivenRegistry()
    registry.ensureServer('chrome', { command: 'chrome-control-mcp' })
    await expect(registry.acquire('chrome', RESEARCHER)).resolves.toEqual({ status: 'held' })
    const waiting = registry.acquire('chrome', ENGINEER)
    expect(registry.snapshot()).toEqual([
      { name: 'chrome', kind: 'exclusive', holders: [RESEARCHER], waiters: [ENGINEER] },
    ])
    registry.release('chrome', RESEARCHER)
    await expect(waiting).resolves.toEqual({ status: 'held' })
    expect(registry.checkCall('chrome', ENGINEER)).toEqual({ status: 'ok' })
  })

  it('answers "resource busy" past the wait, naming the holder', async () => {
    const { registry, advance } = drivenRegistry()
    registry.ensureServer('chrome', { command: 'chrome-control-mcp' })
    await registry.acquire('chrome', RESEARCHER)
    const waiting = registry.acquire('chrome', ENGINEER)
    advance(60_000)
    await expect(waiting).resolves.toEqual({ status: 'busy', holder: RESEARCHER })
    expect(busyText(RESEARCHER)).toBe('resource busy, held by research task task-a')
  })

  it('re-admits the same holder at once for its next call', async () => {
    const { registry } = drivenRegistry()
    registry.ensureServer('chrome', { command: 'chrome-control-mcp' })
    await registry.acquire('chrome', RESEARCHER)
    await expect(registry.acquire('chrome', RESEARCHER)).resolves.toEqual({ status: 'held' })
  })
})

describe('idle release', () => {
  it('releases an MCP server after the idle time with no call open', async () => {
    const { registry, advance } = drivenRegistry()
    registry.ensureServer('chrome', { command: 'chrome-control-mcp' })
    await registry.acquire('chrome', RESEARCHER)
    registry.callStarted('chrome', RESEARCHER)
    registry.callEnded('chrome', RESEARCHER, true)
    advance(119_999)
    expect(registry.checkCall('chrome', ENGINEER)).toEqual({
      status: 'not-holder',
      holder: RESEARCHER,
    })
    advance(1)
    await expect(registry.acquire('chrome', ENGINEER)).resolves.toEqual({ status: 'held' })
  })

  it('keeps the lease for a call longer than the idle time', () => {
    const { registry, advance } = drivenRegistry()
    registry.ensureServer('chrome', { command: 'chrome-control-mcp' })
    void registry.acquire('chrome', RESEARCHER)
    registry.callStarted('chrome', RESEARCHER)
    advance(1_000_000)
    // Idle counts from the last terminal answer, never from the call's start.
    expect(registry.checkCall('chrome', ENGINEER)).toEqual({
      status: 'not-holder',
      holder: RESEARCHER,
    })
    registry.callEnded('chrome', RESEARCHER, true)
    advance(1_000_000)
    expect(registry.checkCall('chrome', RESEARCHER)).toEqual({
      status: 'not-holder',
      holder: undefined,
    })
  })

  it('keeps the lease for a cancelled call the server never answers', () => {
    const { registry, advance } = drivenRegistry()
    registry.declare({ name: 'chrome', kind: 'exclusive' })
    void registry.acquire('chrome', RESEARCHER)
    registry.callStarted('chrome', RESEARCHER)
    registry.callEnded('chrome', RESEARCHER, false)
    advance(1_000_000)
    expect(registry.checkCall('chrome', ENGINEER)).toEqual({
      status: 'not-holder',
      holder: RESEARCHER,
    })
    // The late answer ends the uncertainty; the idle wait starts there.
    registry.callEnded('chrome', RESEARCHER, true)
    advance(119_999)
    expect(registry.checkCall('chrome', ENGINEER).status).toBe('not-holder')
    advance(1)
    expect(registry.checkCall('chrome', RESEARCHER).status).toBe('not-holder')
  })

  it('releases a restarted local server once its process has exited', async () => {
    const { registry } = drivenRegistry()
    registry.declare({ name: 'chrome', kind: 'exclusive' })
    await registry.acquire('chrome', RESEARCHER)
    registry.callStarted('chrome', RESEARCHER)
    registry.callEnded('chrome', RESEARCHER, false)
    registry.markServerExited('chrome')
    await expect(registry.acquire('chrome', ENGINEER)).resolves.toEqual({ status: 'held' })
  })
})

describe('retired holders', () => {
  it('retains a retired lease until every open and uncertain call is terminal', async () => {
    const { registry, advance } = drivenRegistry()
    await heldChrome(registry)
    registry.callStarted('chrome', RESEARCHER)
    registry.callStarted('chrome', RESEARCHER)
    registry.callEnded('chrome', RESEARCHER, false)
    registry.retireAttempt('task-a', 1)
    registry.release('chrome', RESEARCHER)
    expect(registry.checkCall('chrome', RESEARCHER)).toEqual({ status: 'stale-attempt' })
    const waiting = registry.acquire('chrome', ENGINEER)
    registry.callEnded('chrome', RESEARCHER, true)
    advance(120_000)
    expect(registry.snapshot()[0]?.holders).toEqual([RESEARCHER])
    await expect(waiting).resolves.toEqual({ status: 'busy', holder: RESEARCHER })
    registry.callEnded('chrome', RESEARCHER, true)
    await expect(registry.acquire('chrome', ENGINEER)).resolves.toEqual({ status: 'held' })
  })

  it('releases a stopped attempt and refuses its late call by attempt number', async () => {
    const { registry } = drivenRegistry()
    registry.declare({ name: 'chrome', kind: 'exclusive' })
    await registry.acquire('chrome', RESEARCHER)
    registry.retireAttempt('task-a', 1)
    await expect(registry.acquire('chrome', ENGINEER)).resolves.toEqual({ status: 'held' })
    expect(registry.checkCall('chrome', RESEARCHER)).toEqual({ status: 'stale-attempt' })
    await expect(registry.acquire('chrome', RESEARCHER)).resolves.toEqual({ status: 'stale' })
  })

  it('hears a waiter retired while waiting at once', async () => {
    const { registry } = drivenRegistry()
    await heldChrome(registry)
    const waiting = registry.acquire('chrome', ENGINEER)
    registry.retireAttempt('task-b', 1)
    await expect(waiting).resolves.toEqual({ status: 'stale' })
  })
})

describe('take back', () => {
  it('times out a pending Take back admission without transferring an open lease', async () => {
    const { registry, advance } = drivenRegistry()
    await heldChrome(registry)
    registry.callStarted('chrome', RESEARCHER)
    registry.takeBack('chrome', ORCHESTRATOR)
    const waiting = registry.acquire('chrome', ORCHESTRATOR)
    advance(60_000)
    await expect(waiting).resolves.toEqual({ status: 'busy', holder: RESEARCHER })
    expect(registry.snapshot()[0]?.holders).toEqual([RESEARCHER])
    registry.callEnded('chrome', RESEARCHER, true)
    expect(registry.snapshot()[0]?.holders).toEqual([ORCHESTRATOR])
  })

  it('defers Take back until all earlier calls have terminal answers', async () => {
    const { registry, advance } = drivenRegistry()
    await heldChrome(registry)
    registry.callStarted('chrome', RESEARCHER)
    registry.callStarted('chrome', RESEARCHER)
    registry.callEnded('chrome', RESEARCHER, false)
    registry.takeBack('chrome', ORCHESTRATOR)
    expect(registry.checkCall('chrome', RESEARCHER)).toEqual({
      status: 'taken-back',
      holder: ORCHESTRATOR,
    })
    expect(registry.checkCall('chrome', ORCHESTRATOR)).toEqual({
      status: 'not-holder',
      holder: RESEARCHER,
    })
    registry.callEnded('chrome', RESEARCHER, true)
    advance(1_000_000)
    expect(registry.snapshot()[0]?.holders).toEqual([RESEARCHER])
    registry.callEnded('chrome', RESEARCHER, true)
    expect(registry.snapshot()[0]?.holders).toEqual([ORCHESTRATOR])
    await expect(registry.acquire('chrome', RESEARCHER)).resolves.toEqual({
      status: 'busy',
      holder: ORCHESTRATOR,
    })
  })

  it.each(['exit', 'release-anyway'])(
    'ends a pending Take back only on explicit %s',
    async (end) => {
      const { registry } = drivenRegistry()
      await heldChrome(registry)
      registry.callStarted('chrome', RESEARCHER)
      registry.takeBack('chrome', ORCHESTRATOR)
      expect(registry.snapshot()[0]?.holders).toEqual([RESEARCHER])
      if (end === 'exit') {
        registry.markServerExited('chrome')
      } else {
        registry.releaseAnyway('chrome')
      }
      expect(registry.snapshot()[0]?.holders).toEqual([ORCHESTRATOR])
    },
  )

  it('moves the lease to the orchestrator and tells the old holder busy', () => {
    const { registry } = drivenRegistry()
    registry.declare({ name: 'chrome', kind: 'exclusive' })
    void registry.acquire('chrome', RESEARCHER)
    registry.takeBack('chrome', ORCHESTRATOR)
    expect(registry.checkCall('chrome', RESEARCHER)).toEqual({
      status: 'taken-back',
      holder: ORCHESTRATOR,
    })
    expect(busyText(ORCHESTRATOR)).toBe('resource busy, held by orchestrator task main')
    expect(registry.checkCall('chrome', ORCHESTRATOR)).toEqual({ status: 'ok' })
  })
})

describe('the repository file', () => {
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
  it('offers unassigned servers to no role and assigned servers only to their roles', () => {
    const { registry } = drivenRegistry()
    registry.declare({ name: 'chrome', kind: 'exclusive' })
    registry.declare({ name: 'device', kind: 'exclusive', assignedRoles: ['engineering'] })
    registry.ensureServer('notes')
    expect(registry.serversForRole('research')).toEqual([])
    expect(registry.serversForRole('new-project-role')).toEqual([])
    expect(registry.serversForRole('engineering')).toEqual(['device'])
  })

  it('holds nothing for a free resource', async () => {
    const { registry } = drivenRegistry()
    registry.declare({ name: 'clock', kind: 'free' })
    await expect(registry.acquire('clock', RESEARCHER)).resolves.toEqual({ status: 'held' })
    await expect(registry.acquire('clock', ENGINEER)).resolves.toEqual({ status: 'held' })
    expect(registry.checkCall('clock', ENGINEER)).toEqual({ status: 'ok' })
    expect(registry.snapshot()).toEqual([{ name: 'clock', kind: 'free', holders: [], waiters: [] }])
  })

  it('shares up to the limit, then queues', async () => {
    const { registry } = drivenRegistry()
    registry.declare({ name: 'gpu', kind: 'shared', sharedLimit: 2 })
    await expect(registry.acquire('gpu', RESEARCHER)).resolves.toEqual({ status: 'held' })
    await expect(registry.acquire('gpu', ENGINEER)).resolves.toEqual({ status: 'held' })
    const third = registry.acquire('gpu', ORCHESTRATOR)
    registry.release('gpu', RESEARCHER)
    await expect(third).resolves.toEqual({ status: 'held' })
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
  it('stops the timers and tells every waiter', async () => {
    const { registry } = drivenRegistry()
    await heldChrome(registry)
    const waiting = registry.acquire('chrome', ENGINEER)
    registry.close()
    await expect(waiting).resolves.toEqual({ status: 'closed' })
    await expect(registry.acquire('chrome', ENGINEER)).resolves.toEqual({ status: 'closed' })
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
