// M91 lane E: Best-of-N's extension hook points (PLAN.md M91 acceptance 12;
// SoL-Pi rule 7). WorktreeCreate fails its attempt, WorktreeRemove observes,
// and TeammateIdle fires from the coordinator's side — attempts run with
// hooks off — keeping an attempt working inside its bound. Without the seam
// the run behaves as before.

import { describe, expect, it, vi } from 'vitest'
import {
  BestOfNRunner,
  type BestOfNAttemptDriver,
  type BestOfNAttemptStart,
} from '../../src/core/bestOfN/bestOfNRunner'
import { BestOfNCoordinator } from '../../src/core/bestOfN/bestOfNCoordinator'
import { worktreeHookPath } from '../../src/core/worktrees'
import type { BestOfNRun } from '../../src/shared/bestOfN'
import { FakeLogOutputChannel } from './helpers/fakes'
import { FAKE_MODEL_API_ACCOUNT_ID } from './helpers/fakeModelApi'

const HEX_40 = 'a'.repeat(40)

class FakeDriver implements BestOfNAttemptDriver {
  readonly sessionId = undefined
  readonly onEvent: (event: Parameters<BestOfNAttemptStart['onEvent']>[0]) => void
  readonly continued: string[] = []
  continueAttempt: BestOfNAttemptDriver['continueAttempt'] = (reason) => {
    this.continued.push(reason)
    return Promise.resolve()
  }

  constructor(start: BestOfNAttemptStart) {
    this.onEvent = start.onEvent
  }

  cancel(): Promise<void> {
    return Promise.resolve()
  }

  dispose(): void {
    // This fake owns no process or event subscriptions.
  }
}

function setup(
  options: {
    readonly extensionHooks?: {
      readonly fireWorktreeHook: (
        event: 'WorktreeCreate' | 'WorktreeRemove',
        relativePath: string,
      ) => Promise<{ readonly failedReason?: string }>
      readonly fireTeammateIdle: (
        attemptId: string,
        siblingsRunning: number,
      ) => Promise<{ readonly keepWorking: boolean; readonly reason?: string }>
    }
    readonly failSecondAdd?: boolean
  } = {},
) {
  const log = new FakeLogOutputChannel()
  const updates: BestOfNRun[] = []
  const drivers = new Map<string, FakeDriver>()
  const gitCalls: string[][] = []
  const runner = new BestOfNRunner({
    coordinator: new BestOfNCoordinator(),
    newRunId: () => `bon-${(2_000_000).toString(36)}-1`,
    isTrusted: () => true,
    backendKind: () => 'modelApi',
    isBestOfNOn: () => true,
    allowsPaidUse: () => Promise.resolve(true),
    notePaidUse: () => undefined,
    runGit: (args) => {
      gitCalls.push([...args])
      if (args.includes('--absolute-git-dir')) {
        return Promise.resolve('/repo/app/.git')
      }
      if (args.includes('rev-parse') || args.includes('write-tree')) {
        return Promise.resolve(HEX_40)
      }
      return options.failSecondAdd &&
        args.includes('worktree') &&
        args.includes('add') &&
        gitCalls.filter((call) => call.includes('add')).length === 2
        ? Promise.reject(new Error('worktree add failed'))
        : Promise.resolve('')
    },
    getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
    hasDirtyEditors: () => false,
    validatePaths: () => Promise.resolve(),
    validateWorktree: () => Promise.resolve(),
    realPath: (value: string) => Promise.resolve(value),
    repositoryRoot: () => '/repo/app',
    platform: 'linux',
    startAttempt: (start) => {
      const driver = new FakeDriver(start)
      drivers.set(start.attemptId, driver)
      return Promise.resolve(driver)
    },
    onUpdate: (run) => {
      updates.push(run)
    },
    log,
    ...(options.extensionHooks !== undefined && { extensionHooks: options.extensionHooks }),
  })
  return { runner, drivers, updates, gitCalls, log }
}

function completed(terminal = 'completed', wasCeilingReached = false) {
  return {
    type: 'completed',
    requestsMade: 1,
    ceilingReached: wasCeilingReached,
    approvalsDenied: 0,
    terminal,
  } as const
}

async function startTwo(
  t: ReturnType<typeof setup>,
): Promise<{ readonly first: string; readonly second: string }> {
  const run = await t.runner.start({
    prompt: 'go',
    attempts: 2,
    requestCeilingPerAttempt: 5,
    modelId: 'muse-spark-1.3',
    approvalMode: 'allowAll',
    isCurrent: () => true,
  })
  const [first, second] = run.runAttempts.map((attempt) => attempt.attemptId)
  if (first === undefined || second === undefined) {
    throw new Error('expected two attempts')
  }
  return { first, second }
}

describe('BestOfNRunner extension hooks', () => {
  it('never continues an attempt after its request ceiling is reached', async () => {
    const idle = vi.fn(() => Promise.resolve({ keepWorking: true }))
    const t = setup({
      extensionHooks: { fireWorktreeHook: () => Promise.resolve({}), fireTeammateIdle: idle },
    })
    const { first } = await startTwo(t)
    t.drivers.get(first)?.onEvent(completed('completed', true))
    await vi.waitFor(() => {
      expect(t.updates.at(-1)?.runAttempts[0]?.status).toBe('completed')
    })
    expect(idle).not.toHaveBeenCalled()
    expect(t.drivers.get(first)?.continued).toEqual([])
  })
  it('fails the attempt a WorktreeCreate hook refuses, launching the rest', async () => {
    const seen: [string, string][] = []
    const t = setup({
      extensionHooks: {
        fireWorktreeHook: (event, relativePath) => {
          seen.push([event, relativePath])
          return Promise.resolve(seen.length === 1 ? { failedReason: 'hook says no' } : {})
        },
        fireTeammateIdle: () => Promise.resolve({ keepWorking: false }),
      },
    })
    const { first, second } = await startTwo(t)
    expect(seen[0]?.[0]).toBe('WorktreeCreate')
    expect(seen[0]?.[1].startsWith('..')).toBe(true)
    await vi.waitFor(() => {
      expect(
        t.updates.at(-1)?.runAttempts.find((attempt) => attempt.attemptId === first)?.status,
      ).toBe('failed')
    })
    expect(
      t.updates.at(-1)?.runAttempts.find((attempt) => attempt.attemptId === first),
    ).toMatchObject({
      failureReason: 'hook says no',
    })
    // The refused attempt never launched; its sibling did.
    expect(t.drivers.has(first)).toBe(false)
    expect(t.drivers.has(second)).toBe(true)
  })

  it('observes WorktreeRemove before a failed start cleans up', async () => {
    const seen: [string, string][] = []
    const t = setup({
      failSecondAdd: true,
      extensionHooks: {
        fireWorktreeHook: (event, relativePath) => {
          seen.push([event, relativePath])
          return Promise.resolve({})
        },
        fireTeammateIdle: () => Promise.resolve({ keepWorking: false }),
      },
    })
    await expect(startTwo(t)).rejects.toThrow()
    expect(seen.map(([event]) => event)).toEqual(['WorktreeCreate', 'WorktreeRemove'])
    expect(seen[0]?.[1]).toBe(seen[1]?.[1])
  })

  it('keeps an attempt working on TeammateIdle, within its bound', async () => {
    const idleCalls: [string, number][] = []
    const t = setup({
      extensionHooks: {
        fireWorktreeHook: () => Promise.resolve({}),
        fireTeammateIdle: (attemptId, siblingsRunning) => {
          idleCalls.push([attemptId, siblingsRunning])
          return Promise.resolve({ keepWorking: true, reason: 'one more check' })
        },
      },
    })
    const { first } = await startTwo(t)
    const driver = t.drivers.get(first)
    if (driver === undefined) {
      throw new Error('expected a driver')
    }
    for (let index = 0; index < 9; index += 1) {
      driver.onEvent(completed())
      // One poll sees both the hook's answer and the driver's next turn, so
      // the keep count settled before the next completion arrives.
      if (index < 8) {
        await vi.waitFor(() => {
          expect(idleCalls.length).toBe(index + 1)
          expect(driver.continued.length).toBe(index + 1)
        })
      }
    }
    // Eight keeps, then the ninth completion runs: the bound holds.
    await vi.waitFor(() => {
      expect(
        t.updates.at(-1)?.runAttempts.find((attempt) => attempt.attemptId === first)?.status,
      ).toBe('completed')
    })
    expect(idleCalls).toHaveLength(8)
    expect(idleCalls[0]).toEqual([first, 1])
    expect(driver.continued).toHaveLength(8)
    expect(driver.continued[0]).toBe('one more check')
  })

  it('completes normally without the seam', async () => {
    const t = setup()
    const { first, second } = await startTwo(t)
    t.drivers.get(first)?.onEvent(completed())
    t.drivers.get(second)?.onEvent(completed())
    await vi.waitFor(() => {
      expect(t.updates.at(-1)?.runAttempts.map((attempt) => attempt.status)).toEqual([
        'completed',
        'completed',
      ])
    })
  })

  it('completes when the driver cannot continue a kept attempt', async () => {
    const t = setup({
      extensionHooks: {
        fireWorktreeHook: () => Promise.resolve({}),
        fireTeammateIdle: () => Promise.resolve({ keepWorking: true, reason: 'stay' }),
      },
    })
    const { first, second } = await startTwo(t)
    const driver = t.drivers.get(first)
    if (driver === undefined) {
      throw new Error('expected a driver')
    }
    // Without `continueAttempt` the keep cannot run: the attempt completes. An
    // assignment, not a delete: the method lives on the prototype, and an
    // absent optional method reads `undefined` through the check.
    driver.continueAttempt = undefined
    driver.onEvent(completed())
    t.drivers.get(second)?.onEvent(completed())
    await vi.waitFor(() => {
      expect(
        t.updates.at(-1)?.runAttempts.find((attempt) => attempt.attemptId === first)?.status,
      ).toBe('completed')
    })
  })
})

describe('worktreeHookPath', () => {
  it('relativizes a worktree to its repository with forward slashes', () => {
    expect(worktreeHookPath('/repo/app', '/repo/app.worktrees/bon-1-0', 'linux')).toBe(
      '../app.worktrees/bon-1-0',
    )
    expect(worktreeHookPath('/repo/app', '/repo/app', 'linux')).toBe('.')
    expect(
      worktreeHookPath(String.raw`C:\repo\app`, String.raw`C:\repo\app.worktrees\x`, 'win32'),
    ).toBe('../app.worktrees/x')
  })
})
