// M125 lane F1b: one held action through the B1 fence. The floor
// and the conditions decide without starting anything; a hold that
// passes races the reviewer against the shared judge fence and the
// inspect run, and a skip carries the parse with the delivered
// output. Ports are seams in the cascade style; the drills run the
// same orchestration against the real helper.
import { describe, expect, it } from 'vitest'
import {
  raceB1Hold,
  type B1Conditions,
  type B1FloorContext,
  type B1HoldPorts,
} from '../../src/core/judge/fast/approval'
import type { InspectResult } from '../../src/core/judge/fast/inspectExec'
import type { JudgeFence } from '../../src/core/judge/use'

const OUTPUT: InspectResult = {
  kind: 'output',
  stdout: 'allowed\n',
  stderr: '',
  exitCode: 0,
  excluded: 1,
}

const FLOOR: B1FloorContext = {
  settledBy: undefined,
  tool: { network: false, paid: false, spawn: false, mcpWrite: false },
  confidentialNonlocal: false,
}

const CONDITIONS: B1Conditions = {
  mode: 'onRequest',
  isHeadlessRun: false,
  isUntrustedOrigin: false,
  isWorkspaceTrusted: true,
  sessionProcessAlive: false,
  confinementReady: true,
  platform: 'linux',
  certifiedPlatforms: ['linux'],
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function settledFence(outcome: 'caution' | 'none'): JudgeFence {
  return {
    read: () => outcome,
    card: () => undefined,
    discard: () => undefined,
    // A settled run is never a dropped one.
    dropped: () => false,
  }
}

describe('B1 hold', () => {
  it('starts nothing when the floor fails', async () => {
    const started: string[] = []
    const ports: B1HoldPorts<string> = {
      line: 'git status',
      platform: 'linux',
      floor: FLOOR,
      conditions: CONDITIONS,
      startReviewer: () => {
        started.push('reviewer')
        return Promise.resolve('verdict')
      },
      startJudgeFence: () => {
        started.push('fence')
        return undefined
      },
      runInspect: () => {
        started.push('inspect')
        return Promise.resolve(OUTPUT)
      },
    }
    await expect(raceB1Hold(ports)).resolves.toEqual({
      kind: 'notApplicable',
      reason: 'gitCommand',
    })
    expect(started).toEqual([])
  })

  it('starts nothing when the conditions fail', async () => {
    const started: string[] = []
    const ports: B1HoldPorts<string> = {
      line: 'cat allowed.txt',
      platform: 'linux',
      floor: FLOOR,
      conditions: { ...CONDITIONS, certifiedPlatforms: [] },
      startReviewer: () => {
        started.push('reviewer')
        return Promise.resolve('verdict')
      },
      startJudgeFence: () => {
        started.push('fence')
        return undefined
      },
      runInspect: () => {
        started.push('inspect')
        return Promise.resolve(OUTPUT)
      },
    }
    await expect(raceB1Hold(ports)).resolves.toEqual({
      kind: 'notApplicable',
      reason: 'uncertifiedPlatform',
    })
    expect(started).toEqual([])
  })

  it('skips on the shared fence and the delivered run, with the parse', async () => {
    let inspected = ''
    const ports: B1HoldPorts<string> = {
      line: 'cat   allowed.txt',
      platform: 'linux',
      floor: FLOOR,
      conditions: CONDITIONS,
      startReviewer: async (signal, shareFence) => {
        shareFence()
        await delay(500)
        signal.throwIfAborted()
        return 'verdict'
      },
      startJudgeFence: () => settledFence('none'),
      runInspect: async (canonical, signal) => {
        inspected = canonical
        await delay(10)
        signal.throwIfAborted()
        return OUTPUT
      },
      vetoWindowMs: 100,
      vetoPollMs: 5,
    }
    const outcome = await raceB1Hold(ports)
    expect(outcome.kind).toBe('skip')
    if (outcome.kind !== 'skip') return
    expect(inspected).toBe('cat allowed.txt')
    expect(outcome.canonical).toBe('cat allowed.txt')
    expect(outcome.parsed.program).toBe('cat')
    expect(outcome.stdout).toBe('allowed\n')
    expect(outcome.excluded).toBe(1)
    expect(outcome.detail).toBeUndefined()
  })

  it("passes the reviewer's verdict through when it wins", async () => {
    const ports: B1HoldPorts<string> = {
      line: 'cat allowed.txt',
      platform: 'linux',
      floor: FLOOR,
      conditions: CONDITIONS,
      startReviewer: async (signal, shareFence) => {
        shareFence()
        await delay(10)
        signal.throwIfAborted()
        return 'allow-it'
      },
      startJudgeFence: () => settledFence('none'),
      runInspect: async (_canonical, signal) => {
        await delay(500)
        signal.throwIfAborted()
        return OUTPUT
      },
      vetoWindowMs: 100,
      vetoPollMs: 5,
    }
    await expect(raceB1Hold(ports)).resolves.toEqual({ kind: 'reviewer', verdict: 'allow-it' })
  })

  it('vetoes on the shared caution fence', async () => {
    const ports: B1HoldPorts<string> = {
      line: 'cat allowed.txt',
      platform: 'linux',
      floor: FLOOR,
      conditions: CONDITIONS,
      startReviewer: async (signal, shareFence) => {
        shareFence()
        await delay(50)
        signal.throwIfAborted()
        return 'verdict'
      },
      startJudgeFence: () => settledFence('caution'),
      runInspect: async (_canonical, signal) => {
        await delay(10)
        signal.throwIfAborted()
        return OUTPUT
      },
      vetoWindowMs: 100,
      vetoPollMs: 5,
    }
    await expect(raceB1Hold(ports)).resolves.toEqual({ kind: 'reviewer', verdict: 'verdict' })
  })

  it('vetoes when no fence is ever shared', async () => {
    const ports: B1HoldPorts<string> = {
      line: 'cat allowed.txt',
      platform: 'linux',
      floor: FLOOR,
      conditions: CONDITIONS,
      startReviewer: async (signal, shareFence) => {
        shareFence()
        await delay(60)
        signal.throwIfAborted()
        return 'verdict'
      },
      startJudgeFence: () => undefined,
      runInspect: async (_canonical, signal) => {
        await delay(10)
        signal.throwIfAborted()
        return OUTPUT
      },
      vetoWindowMs: 40,
      vetoPollMs: 5,
    }
    await expect(raceB1Hold(ports)).resolves.toEqual({ kind: 'reviewer', verdict: 'verdict' })
  })
})
