// The shared-resource registry (M96 lane B, PLAN.md D75 acceptances 44): the
// defaults matched by command and package, command patterns, leases with
// holder and attempt, the queue with its wait and "busy", idle release only
// after every call is terminal, Take back, and the hint question.

import { describe, expect, it } from 'vitest'
import {
  busyText,
  defaultResourceKind,
  type LeaseHolder,
  type RegistryClock,
  ResourceRegistry,
} from '../../src/core/team/resources'

const RESEARCHER: LeaseHolder = { role: 'research', taskId: 'task-a', attempt: 1 }
const ENGINEER: LeaseHolder = { role: 'engineering', taskId: 'task-b', attempt: 1 }
const ORCHESTRATOR: LeaseHolder = { role: 'orchestrator', taskId: 'main', attempt: 1 }

interface Scheduled {
  callback: () => void
  at: number
  cancelled: boolean
}

interface Delayed {
  resolve: () => void
  at: number
}

/** A clock the test drives: `advance` fires due timers and delays in order. */
function fakeClock() {
  let now = 1000
  const scheduled: Scheduled[] = []
  const delayed: Delayed[] = []
  const clock: RegistryClock = {
    now: () => now,
    delay: (ms: number) =>
      new Promise<void>((resolve) => {
        delayed.push({ resolve, at: now + ms })
      }),
    schedule: (callback: () => void, ms: number) => {
      const entry: Scheduled = { callback, at: now + ms, cancelled: false }
      scheduled.push(entry)
      return {
        cancel: () => {
          entry.cancelled = true
        },
      }
    },
  }
  return {
    clock,
    advance(ms: number): void {
      now += ms
      const due = scheduled.splice(0).toSorted((left, right) => left.at - right.at)
      for (const entry of due) {
        if (!entry.cancelled && entry.at <= now) {
          entry.callback()
        } else if (!entry.cancelled) {
          scheduled.push(entry)
        }
      }
      for (const entry of delayed.splice(0)) {
        if (entry.at <= now) {
          entry.resolve()
        } else {
          delayed.push(entry)
        }
      }
    },
  }
}

function drivenRegistry() {
  const driven = fakeClock()
  return {
    ...driven,
    registry: new ResourceRegistry({ clock: driven.clock, waitMs: 60_000, idleMs: 120_000 }),
  }
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
    expect(registry.checkCall('chrome', ENGINEER).status).toBe('not-holder')
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
    expect(registry.checkCall('chrome', ENGINEER).status).toBe('not-holder')
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
    expect(registry.checkCall('chrome', ENGINEER).status).toBe('not-holder')
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
    registry.declare({ name: 'chrome', kind: 'exclusive' })
    await registry.acquire('chrome', RESEARCHER)
    const waiting = registry.acquire('chrome', ENGINEER)
    registry.retireAttempt('task-b', 1)
    await expect(waiting).resolves.toEqual({ status: 'stale' })
  })
})

describe('take back', () => {
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
  it('serves every unassigned server to every role, and an assigned one only to its roles', () => {
    const { registry } = drivenRegistry()
    registry.declare({ name: 'chrome', kind: 'exclusive' })
    registry.declare({ name: 'device', kind: 'exclusive', assignedRoles: ['engineering'] })
    expect(registry.serversForRole('research')).toEqual(['chrome'])
    expect(registry.serversForRole('engineering')).toEqual(['chrome', 'device'])
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
    registry.declare({ name: 'chrome', kind: 'exclusive' })
    await registry.acquire('chrome', RESEARCHER)
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
