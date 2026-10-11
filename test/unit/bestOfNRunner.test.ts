import { Usd } from '../../src/shared/usd'
// The best-of-N run (M77, PLAN.md D49): one popup, N worktrees, diffs per
// attempt, and a take that merges only the taken branch.

import { describe, expect, it, vi } from 'vitest'
import * as resourceAdmission from '../../src/core/resources/admission'
import {
  BestOfNError,
  BestOfNRunner,
  type BestOfNAttemptDriver,
  type BestOfNAttemptEvent,
  type BestOfNRunnerDeps,
  type BestOfNStart,
} from '../../src/core/bestOfN/bestOfNRunner'
import type { BestOfNRun } from '../../src/shared/bestOfN'
import { BestOfNCoordinator } from '../../src/core/bestOfN/bestOfNCoordinator'
import { VerifyLedger } from '../../src/core/backends/modelapi/verifyLedger'
import { WorkspaceEdits } from '../../src/core/verify/workspaceEdits'
import type { PaidUseRequest } from '../../src/shared/paid'
import { awaitCompletedRun, awaitRunStatus, bestOfNCommandArgs } from './helpers/bestOfN'
import { FakeLogOutputChannel } from './helpers/fakes'
import type { ResponseAttemptGuard } from '../../src/core/backends/modelapi/client'

interface ScriptedDriver {
  onEvent: (event: BestOfNAttemptEvent) => void
  cancel: () => Promise<void>
  dispose: () => void
  sessionId: string | undefined
  admitRequest: (keyDigest: string | undefined) => void
}

function runnerWith(
  overrides: Partial<{
    isTrusted: boolean
    backendKind: 'museCode' | 'modelApi'
    isBestOfNOn: boolean
    allowsPaidUse: boolean
    repositoryRoot: string | undefined
    newRunId: string
    git: (args: readonly string[], cwd: string) => string
    launch: (attemptId: string) => void
    deps: Partial<BestOfNRunnerDeps>
  }> = {},
): {
  runner: BestOfNRunner
  gitCalls: {
    readonly args: readonly string[]
    readonly rawArgs: readonly string[]
    readonly cwd: string
  }[]
  paidRequests: PaidUseRequest[]
  noted: number[]
  updates: BestOfNRun[]
  drivers: Map<string, ScriptedDriver>
  startCalls: string[]
} {
  const gitCalls: {
    readonly args: readonly string[]
    readonly rawArgs: readonly string[]
    readonly cwd: string
  }[] = []
  const paidRequests: PaidUseRequest[] = []
  const noted: number[] = []
  const updates: BestOfNRun[] = []
  const drivers = new Map<string, ScriptedDriver>()
  const startCalls: string[] = []
  const gitBehavior =
    overrides.git ??
    ((args: readonly string[]): string => {
      if (args[0] === 'rev-parse' || args.includes('write-tree')) {
        return 'a'.repeat(40)
      }
      if (args[1] === '--numstat') {
        return ''
      }
      return args[0] === 'diff' ? 'diff --git a/src/a.ts b/src/a.ts\n' : ''
    })
  const deps: BestOfNRunnerDeps = {
    coordinator: new BestOfNCoordinator(),
    getAccountId: () => Promise.resolve('account-1'),
    hasDirtyEditors: () => false,
    validatePaths: () => Promise.resolve(undefined),
    validateWorktree: () => Promise.resolve(undefined),
    realPath: (file) => Promise.resolve(file),
    newRunId: () => overrides.newRunId ?? 'bon-m1-1',
    isTrusted: () => overrides.isTrusted ?? true,
    backendKind: () => overrides.backendKind ?? 'modelApi',
    isBestOfNOn: () => overrides.isBestOfNOn ?? true,
    allowsPaidUse: (request) => {
      paidRequests.push(request)
      return Promise.resolve(overrides.allowsPaidUse ?? true)
    },
    notePaidUse: (attempts) => {
      noted.push(attempts)
    },
    runGit: (args, cwd) => {
      const command = bestOfNCommandArgs(args)
      gitCalls.push({ args: command, rawArgs: args, cwd })
      if (command.includes('--absolute-git-dir')) return Promise.resolve('/repo/app/.git')
      const result = gitBehavior(command, cwd)
      return Promise.resolve(
        result === '' && (command[0] === 'rev-parse' || command.includes('write-tree'))
          ? 'a'.repeat(40)
          : result,
      )
    },
    repositoryRoot: () =>
      Object.hasOwn(overrides, 'repositoryRoot') ? overrides.repositoryRoot : '/repo/app',
    platform: 'linux',
    startAttempt: (start) => {
      startCalls.push(start.attemptId)
      overrides.launch?.(start.attemptId)
      start.admitRequest('account-1')
      start.admitRequest.onRequestStarted?.()
      const driver: BestOfNAttemptDriver = {
        sessionId: `session-${start.attemptId}`,
        cancel: () => Promise.resolve(undefined),
        dispose: () => undefined,
      }
      drivers.set(start.attemptId, {
        onEvent: (event: BestOfNAttemptEvent) => {
          start.onEvent(event)
        },
        cancel: () => driver.cancel(),
        dispose: () => {
          driver.dispose()
        },
        sessionId: driver.sessionId,
        admitRequest: (keyDigest) => {
          start.admitRequest(keyDigest)
          start.admitRequest.onRequestStarted?.()
        },
      })
      return Promise.resolve(driver)
    },
    onUpdate: (run) => {
      updates.push(run)
    },
    log: new FakeLogOutputChannel(),
    ...overrides.deps,
  }
  return {
    runner: new BestOfNRunner(deps),
    gitCalls,
    paidRequests,
    noted,
    updates,
    drivers,
    startCalls,
  }
}

const START: BestOfNStart = {
  prompt: 'refactor the queue',
  attempts: 3,
  requestCeilingPerAttempt: 20,
  modelId: 'muse-spark-1.3',
  approvalMode: 'onRequest',
  isCurrent: () => true,
}

it('M106 tags every best-of-N attempt for shared request pacing', async () => {
  const guards: ResponseAttemptGuard[] = []
  const t = runnerWith({
    deps: {
      startAttempt: (start) => {
        guards.push(start.admitRequest)
        return Promise.resolve({
          sessionId: start.attemptId,
          cancel: () => Promise.resolve(),
          dispose: () => undefined,
        })
      },
    },
  })
  await t.runner.start(START)
  expect(guards).toHaveLength(3)
  expect(guards.map((guard) => guard.pacingClass)).toEqual(['bestOfN', 'bestOfN', 'bestOfN'])
  await t.runner.cancel()
})

class OtherBundleError extends Error {
  public constructor(public readonly refusal: string) {
    super(refusal)
    this.name = 'BestOfNError'
  }
}

describe('best-of-N errors from another bundle', () => {
  it('preserves the eager host refusal instead of relabeling it as a worktree failure', async () => {
    const refusal = new OtherBundleError('budgetUnavailable')
    const t = runnerWith({ deps: { getBudgetScope: () => Promise.reject(refusal) } })
    await expect(t.runner.start(START)).rejects.toBe(refusal)
    expect(t.noted).toEqual([])
  })
  it('preserves a refusal from the eager write boundary during Take', async () => {
    const refusal = new OtherBundleError('contextChanged')
    const t = runnerWith({
      git: (args) => {
        if (args[0] === 'apply') throw refusal
        if (args[1] === '--numstat') return ''
        return args[0] === 'diff' ? 'diff --git a/src/a.ts b/src/a.ts\n' : ''
      },
    })
    await t.runner.start(START)
    completeAll(t.drivers, ['bon-m1-1-0', 'bon-m1-1-1', 'bon-m1-1-2'])
    await awaitCompletedRun(t.updates)
    await expect(t.runner.take('bon-m1-1-0')).rejects.toBe(refusal)
  })
})

function fire(
  drivers: Map<string, ScriptedDriver>,
  attemptId: string,
  event: BestOfNAttemptEvent,
): void {
  drivers.get(attemptId)?.onEvent(event)
}

const DEFAULT_OUTCOME = { requestsMade: 4, ceilingReached: false, approvalsDenied: 0 }

function completeAll(
  drivers: Map<string, ScriptedDriver>,
  attempts: readonly string[],
  outcome: {
    requestsMade: number
    ceilingReached: boolean
    approvalsDenied: number
  } = DEFAULT_OUTCOME,
): void {
  for (const attemptId of attempts) {
    fire(drivers, attemptId, { type: 'completed', terminal: 'completed', ...outcome })
  }
}

describe('BestOfNRunner guards', () => {
  it('starts no attempt if cancellation outlives its resource wait', async () => {
    const lease = { register: vi.fn(), complete: vi.fn(), background: vi.fn() }
    const hold = Promise.withResolvers<typeof lease>()
    const admission = vi.spyOn(resourceAdmission, 'admitResource').mockReturnValue(hold.promise)
    const t = runnerWith()
    try {
      const pending = t.runner.start(START)
      const cancelled = expect(pending).rejects.toMatchObject({ refusal: 'contextChanged' })
      await vi.waitFor(() => {
        expect(admission).toHaveBeenCalledWith('bestOfN', expect.any(AbortSignal), 'background')
      })
      await t.runner.cancel()
      hold.resolve(lease)
      await cancelled
      expect(t.startCalls).toEqual([])
      expect(lease.complete).toHaveBeenCalledWith(true)
    } finally {
      hold.resolve(lease)
      admission.mockRestore()
      t.runner.dispose()
    }
  })
  it('cannot republish a disposed account run when its old popup settles', async () => {
    const entered = Promise.withResolvers<undefined>()
    const consent = Promise.withResolvers<boolean>()
    const coordinator = new BestOfNCoordinator()
    const t = runnerWith({
      deps: {
        coordinator,
        allowsPaidUse: () => {
          entered.resolve(undefined)
          return consent.promise
        },
      },
    })
    const pending = t.runner.start(START)
    await entered.promise
    t.runner.dispose()
    const count = t.updates.length
    consent.resolve(true)
    await expect(pending).rejects.toMatchObject({ refusal: 'contextChanged' })
    expect(coordinator.snapshots()).toEqual([])
    expect(t.updates).toHaveLength(count)
  })
  it('owns the window before a held popup and refuses a second surface', async () => {
    const consent = Promise.withResolvers<boolean>()
    const coordinator = new BestOfNCoordinator()
    const first = runnerWith({ deps: { coordinator, allowsPaidUse: () => consent.promise } })
    const second = runnerWith({ deps: { coordinator } })
    const pending = first.runner.start(START)
    await expect(second.runner.start(START)).rejects.toMatchObject({ refusal: 'alreadyRunning' })
    expect(second.paidRequests).toEqual([])
    expect(second.gitCalls).toEqual([])
    consent.resolve(true)
    await pending
    await first.runner.cancel()
  })

  it.each(['trust', 'account', 'context'] as const)(
    'refuses %s changed while consent waits',
    async (change) => {
      const consent = Promise.withResolvers<boolean>()
      const entered = Promise.withResolvers<undefined>()
      let isTrusted = true
      let accountId = 'account-1'
      let isCurrent = true
      const t = runnerWith({
        deps: {
          isTrusted: () => isTrusted,
          getAccountId: () => Promise.resolve(accountId),
          allowsPaidUse: () => {
            entered.resolve(undefined)
            return consent.promise
          },
        },
      })
      const pending = t.runner.start({ ...START, isCurrent: () => isCurrent })
      await entered.promise
      switch (change) {
        case 'trust': {
          isTrusted = false
          break
        }
        case 'account': {
          accountId = 'account-2'
          break
        }
        case 'context': {
          isCurrent = false
          break
        }
      }
      consent.resolve(true)
      await expect(pending).rejects.toMatchObject({
        refusal: change === 'trust' ? 'untrusted' : 'contextChanged',
      })
      expect(t.gitCalls).toEqual([])
      expect(t.noted).toEqual([])
    },
  )

  it('cancels a pending popup before any worktree or paid attempt starts', async () => {
    const consent = Promise.withResolvers<boolean>()
    const entered = Promise.withResolvers<undefined>()
    const t = runnerWith({
      deps: {
        allowsPaidUse: () => {
          entered.resolve(undefined)
          return consent.promise
        },
      },
    })
    const pending = t.runner.start(START)
    await entered.promise
    await t.runner.cancel()
    consent.resolve(true)
    await expect(pending).rejects.toMatchObject({ refusal: 'contextChanged' })
    expect(t.startCalls).toEqual([])
    expect(t.gitCalls).toEqual([])
    expect(t.noted).toEqual([])
  })

  it('bounds actual admissions, preserves early progress, and refuses a different key', async () => {
    const t = runnerWith()
    const run = await t.runner.start({ ...START, requestCeilingPerAttempt: 5 })
    const first = t.drivers.get(run.runAttempts[0]?.attemptId ?? '')
    if (first === undefined) throw new Error('Expected an attempt guard')
    expect(run.runAttempts[0]?.requestsMade).toBe(1)
    expect(() => {
      first.admitRequest('account-2')
    }).toThrow(BestOfNError)
    for (let index = 1; index < 5; index += 1) first.admitRequest('account-1')
    expect(() => {
      first.admitRequest('account-1')
    }).toThrow(BestOfNError)
    expect(t.updates.at(-1)?.runAttempts[0]).toMatchObject({
      requestsMade: 5,
      ceilingReached: true,
    })
    expect(t.noted).toEqual([1, 1, 1])
  })

  it('refuses an owned parent scope invalidated during the paid popup', async () => {
    let isCurrent = true
    const t = runnerWith({
      deps: {
        getBudgetScope: () =>
          Promise.resolve({
            sessionId: 'parent-1',
            accountId: 'account-1',
            capUsd: () => Usd.from(1).toAmount(),
            isStillAllowed: () => isCurrent,
            journal: {
              read: () => Promise.reject(new Error('scope journal is not called by runner')),
              reserve: () => Promise.reject(new Error('scope journal is not called by runner')),
              record: () => Promise.reject(new Error('scope journal is not called by runner')),
            },
          }),
        allowsPaidUse: () => {
          isCurrent = false
          return Promise.resolve(true)
        },
      },
    })
    await expect(t.runner.start(START)).rejects.toMatchObject({ refusal: 'contextChanged' })
    expect(t.gitCalls).toEqual([])
    expect(t.noted).toEqual([])
  })
  it.each([
    ['no workspace', { repositoryRoot: undefined }, 'noWorkspace'],
    ['Restricted Mode', { isTrusted: false }, 'untrusted'],
    ['the Muse Code backend', { backendKind: 'museCode' as const }, 'wrongBackend'],
    ['a switched-off feature', { isBestOfNOn: false }, 'paidOff'],
    ['a blank prompt', {}, 'invalid'],
    ['a declined popup', { allowsPaidUse: false }, 'consentDeclined'],
  ])('refuses %s', async (_label, options, refusal) => {
    const t = runnerWith(options)
    const start: BestOfNStart = refusal === 'invalid' ? { ...START, prompt: '  ' } : START
    await expect(t.runner.start(start)).rejects.toMatchObject({ refusal })
  })

  it('refuses an unpriced model and a bad count', async () => {
    const t = runnerWith()
    await expect(t.runner.start({ ...START, modelId: 'muse-unknown-9' })).rejects.toMatchObject({
      refusal: 'unknownModel',
    })
    await expect(t.runner.start({ ...START, attempts: 1 })).rejects.toMatchObject({
      refusal: 'invalid',
    })
  })

  it('refuses a run id that is not branch-safe', async () => {
    const t = runnerWith({ newRunId: '../escape' })
    await expect(t.runner.start(START)).rejects.toThrow('branch-safe')
  })

  it('refuses a second start while one runs, then allows one after it settles', async () => {
    const t = runnerWith()
    await t.runner.start(START)
    await expect(t.runner.start(START)).rejects.toMatchObject({ refusal: 'alreadyRunning' })
    completeAll(t.drivers, ['bon-m1-1-0', 'bon-m1-1-1', 'bon-m1-1-2'])
    await awaitCompletedRun(t.updates)
    await t.runner.start(START)
    expect(t.startCalls).toHaveLength(6)
  })

  it('removes the worktrees it made when git fails half-way', async () => {
    let isArmed = true
    const t = runnerWith({
      git: (args) => {
        if (isArmed && args[0] === 'worktree' && args[1] === 'add') {
          const folder = args.find((part) => part.includes('bon-m1-1-2'))
          if (folder !== undefined) {
            isArmed = false
            throw new Error('disk full')
          }
        }
        return ''
      },
    })
    await expect(t.runner.start(START)).rejects.toMatchObject({ refusal: 'worktreeFailed' })
    const removes = t.gitCalls.filter((call) => call.args[1] === 'remove')
    expect(removes).toHaveLength(2)
    // The removed folders, and the one git never made, have nothing to open.
    expect(t.updates.at(-1)?.runAttempts.map((attempt) => attempt.hasWorktree)).toEqual([
      false,
      false,
      undefined,
    ])
    // The failed start leaves no run behind: a retry may start.
    await t.runner.start(START)
  })

  it('marks only the attempts whose worktree git made as owning one', async () => {
    const declined = runnerWith({ allowsPaidUse: false })
    await expect(declined.runner.start(START)).rejects.toMatchObject({
      refusal: 'consentDeclined',
    })
    expect(
      declined.updates
        .at(-1)
        ?.runAttempts.map((attempt) => [attempt.status, attempt.hasWorktree === true]),
    ).toEqual([
      ['cancelled', false],
      ['cancelled', false],
      ['cancelled', false],
    ])
    const started = runnerWith()
    const run = await started.runner.start(START)
    expect(run.runAttempts.map((attempt) => attempt.hasWorktree)).toEqual([true, true, true])
  })
})

describe('BestOfNRunner runs', () => {
  it('asks once with the prompt, N and the ceiling, then tallies the attempts', async () => {
    const t = runnerWith()
    const run = await t.runner.start(START)
    expect(t.paidRequests).toEqual([
      {
        feature: 'bestOfN',
        modelId: 'muse-spark-1.3',
        prompt: 'refactor the queue',
        attempts: 3,
        requestCeilingPerAttempt: 20,
      },
    ])
    expect(t.noted).toEqual([1, 1, 1])
    expect(run.runAttempts.map((attempt) => attempt.branch)).toEqual([
      'best-of-n/bon-m1-1/0',
      'best-of-n/bon-m1-1/1',
      'best-of-n/bon-m1-1/2',
    ])
    const adds = t.gitCalls.filter((call) => call.args[1] === 'add')
    expect(adds).toHaveLength(3)
    expect(adds[0]?.args).toContain('best-of-n/bon-m1-1/0')
    expect(t.startCalls).toEqual(['bon-m1-1-0', 'bon-m1-1-1', 'bon-m1-1-2'])
    // Every attempt carries its session.
    expect(run.runAttempts[0]?.sessionId).toBe('session-bon-m1-1-0')
  })

  it('collects each attempt diff and completes the run', async () => {
    const t = runnerWith({
      git: (args) => {
        if (args[0] === 'diff' && args[1] === '--numstat') {
          return '3\t1\tsrc/a.ts\n'
        }
        return args[0] === 'diff' ? 'diff --git a/src/a.ts b/src/a.ts\n' : ''
      },
    })
    await t.runner.start(START)
    fire(t.drivers, 'bon-m1-1-0', {
      type: 'requestCompleted',
      requestsMade: 2,
    })
    completeAll(t.drivers, ['bon-m1-1-0', 'bon-m1-1-1', 'bon-m1-1-2'])
    await awaitCompletedRun(t.updates)
    const last = t.updates.at(-1)
    expect(last?.runAttempts[0]).toMatchObject({
      status: 'completed',
      requestsMade: 1,
      files: [{ path: 'src/a.ts', insertions: 3, deletions: 1 }],
      changedLines: 4,
      diff: 'diff --git a/src/a.ts b/src/a.ts\n',
    })
    expect(last?.runAttempts[1]?.requestsMade).toBe(1)
  })

  it('fails an attempt whose immutable diff git cannot read', async () => {
    const t = runnerWith({
      git: (args) => {
        if (args[0] === 'diff') {
          throw new Error('repo locked')
        }
        return ''
      },
    })
    await t.runner.start(START)
    completeAll(t.drivers, ['bon-m1-1-0', 'bon-m1-1-1', 'bon-m1-1-2'])
    await awaitRunStatus(t.updates, 'failed')
    expect(t.updates.at(-1)?.runAttempts[0]).toMatchObject({
      status: 'failed',
      files: [],
      changedLines: 0,
    })
    expect(t.updates.at(-1)?.runAttempts[0]).not.toHaveProperty('diff')
  })

  it('completes the run when some attempts fail', async () => {
    const t = runnerWith()
    await t.runner.start(START)
    fire(t.drivers, 'bon-m1-1-0', { type: 'failed', reason: 'key missing' })
    completeAll(t.drivers, ['bon-m1-1-1', 'bon-m1-1-2'])
    await awaitCompletedRun(t.updates)
    expect(t.updates.at(-1)?.runAttempts[0]).toMatchObject({
      status: 'failed',
      failureReason: 'key missing',
    })
  })

  it('fails the run only when every attempt fails', async () => {
    const t = runnerWith()
    await t.runner.start(START)
    fire(t.drivers, 'bon-m1-1-0', { type: 'failed', reason: 'one' })
    fire(t.drivers, 'bon-m1-1-1', { type: 'failed', reason: 'two' })
    fire(t.drivers, 'bon-m1-1-2', { type: 'failed', reason: 'three' })
    await awaitRunStatus(t.updates, 'failed')
  })

  it('a failed launch marks its attempt without stopping the others', async () => {
    const t = runnerWith({
      launch: (attemptId) => {
        if (attemptId === 'bon-m1-1-1') {
          throw new Error('session busy')
        }
      },
    })
    await t.runner.start(START)
    await vi.waitFor(() => {
      expect(
        t.updates.at(-1)?.runAttempts.find((attempt) => attempt.attemptId === 'bon-m1-1-1')?.status,
      ).toBe('failed')
    })
    expect(t.startCalls).toEqual(['bon-m1-1-0', 'bon-m1-1-1', 'bon-m1-1-2'])
    expect(
      t.updates.at(-1)?.runAttempts.find((attempt) => attempt.attemptId === 'bon-m1-1-1')
        ?.failureReason,
    ).toBe('session busy')
  })
})

describe('BestOfNRunner take and cancel', () => {
  it.each(['cancel', 'trust', 'context'])(
    'does not add files after %s changes during capture validation',
    async (change) => {
      const held = Promise.withResolvers<undefined>()
      const validating = Promise.withResolvers<undefined>()
      let shouldHold = false
      let isTrusted = true
      let isCurrent = true
      const log = new FakeLogOutputChannel()
      const t = runnerWith({
        deps: {
          log,
          isTrusted: () => isTrusted,
          validateWorktree: async () => {
            if (!shouldHold) {
              return
            }

            validating.resolve(undefined)
            await held.promise
          },
        },
      })
      await t.runner.start({ ...START, isCurrent: () => isCurrent })
      shouldHold = true
      fire(t.drivers, 'bon-m1-1-0', {
        type: 'completed',
        terminal: 'completed',
        requestsMade: 1,
        ceilingReached: false,
        approvalsDenied: 0,
      })
      try {
        await validating.promise
        if (change === 'cancel') await t.runner.cancel()
        else if (change === 'trust') isTrusted = false
        else isCurrent = false
        held.resolve(undefined)
        await vi.waitFor(() => {
          expect(log.warn).toHaveBeenCalledWith(
            "A best-of-N attempt's immutable comparison could not be captured",
          )
        })
        expect(
          t.gitCalls.some((call) => call.args.includes('add') && call.args.includes('--all')),
        ).toBe(false)
      } finally {
        held.resolve(undefined)
        t.runner.dispose()
      }
    },
  )

  it.each(['failed', 'cancelled', 'future_terminal'])(
    'never takes terminal %s',
    async (terminal) => {
      const t = runnerWith()
      await t.runner.start(START)
      fire(t.drivers, 'bon-m1-1-0', {
        type: 'completed',
        terminal,
        reason: 'backend outcome',
        ...DEFAULT_OUTCOME,
      })
      await expect(t.runner.take('bon-m1-1-0')).rejects.toMatchObject({ refusal: 'attemptNotDone' })
      expect(t.gitCalls.some((call) => call.args[0] === 'apply')).toBe(false)
      expect(t.updates.at(-1)?.runAttempts[0]?.failureReason).toBe('backend outcome')
    },
  )

  it('refuses a dirty editor before any apply', async () => {
    const t = runnerWith({ deps: { hasDirtyEditors: () => true } })
    await t.runner.start(START)
    completeAll(t.drivers, ['bon-m1-1-0', 'bon-m1-1-1', 'bon-m1-1-2'])
    await awaitCompletedRun(t.updates)
    await expect(t.runner.take('bon-m1-1-0')).rejects.toMatchObject({ refusal: 'targetChanged' })
    expect(t.gitCalls.some((call) => call.args[0] === 'apply')).toBe(false)
  })
  it('applies and stages only the selected preview, then stops the rest', async () => {
    const t = runnerWith()
    await t.runner.start(START)
    // One attempt still runs while another is taken: the take stops it.
    completeAll(t.drivers, ['bon-m1-1-1'])
    await vi.waitFor(() => {
      expect(
        t.updates.at(-1)?.runAttempts.find((attempt) => attempt.attemptId === 'bon-m1-1-1')?.status,
      ).toBe('completed')
    })
    const run = await t.runner.take('bon-m1-1-1')
    const merges = t.gitCalls.filter((call) => call.args[0] === 'apply')
    expect(merges).toHaveLength(1)
    expect(merges[0]?.args).toEqual(['apply', '--index', '--binary', '-'])
    expect(merges[0]?.rawArgs.slice(0, 2)).toEqual([
      '--git-dir=/repo/app/.git',
      '--work-tree=/repo/app',
    ])
    expect(run.takenBranch).toBe('best-of-n/bon-m1-1/1')
    expect(run.runAttempts.find((attempt) => attempt.attemptId === 'bon-m1-1-0')?.status).toBe(
      'cancelled',
    )
    await expect(t.runner.take('bon-m1-1-0')).rejects.toMatchObject({
      refusal: 'alreadyTaken',
    })
  })

  it('refuses takes with no run, a wrong id or an unfinished attempt', async () => {
    const t = runnerWith()
    await expect(t.runner.take('bon-m1-1-0')).rejects.toMatchObject({ refusal: 'noRun' })
    await t.runner.start(START)
    await expect(t.runner.take('bon-missing')).rejects.toMatchObject({
      refusal: 'unknownAttempt',
    })
    await expect(t.runner.take('bon-m1-1-0')).rejects.toMatchObject({
      refusal: 'attemptNotDone',
    })
    await expect(t.runner.start(START)).rejects.toMatchObject({ refusal: 'alreadyRunning' })
  })

  it('reports an apply failure without claiming the preview was taken', async () => {
    const t = runnerWith({
      git: (args) => {
        if (args[0] === 'apply') {
          throw new Error('conflict in queue.ts')
        }
        if (args[1] === '--numstat') {
          return ''
        }
        return args[0] === 'diff' ? 'diff --git a/src/a.ts b/src/a.ts\n' : ''
      },
    })
    await t.runner.start(START)
    completeAll(t.drivers, ['bon-m1-1-0', 'bon-m1-1-1', 'bon-m1-1-2'])
    await awaitCompletedRun(t.updates)
    let error: unknown
    try {
      await t.runner.take('bon-m1-1-2')
    } catch (error_) {
      error = error_
    }
    if (!(error instanceof BestOfNError)) {
      throw new Error('Expected the take to fail as a best-of-N refusal')
    }
    expect(error.refusal).toBe('worktreeFailed')
    expect(error.detail).toBe('conflict in queue.ts')
  })

  it('cancels what still runs and keeps finished diffs', async () => {
    const t = runnerWith()
    await t.runner.start(START)
    completeAll(t.drivers, ['bon-m1-1-0'])
    await vi.waitFor(() => {
      expect(
        t.updates.at(-1)?.runAttempts.find((attempt) => attempt.attemptId === 'bon-m1-1-0')?.status,
      ).toBe('completed')
    })
    const run = await t.runner.cancel()
    expect(run.status).toBe('completed')
    expect(run.runAttempts.find((attempt) => attempt.attemptId === 'bon-m1-1-1')?.status).toBe(
      'cancelled',
    )
    const t2 = runnerWith()
    await expect(t2.runner.cancel()).rejects.toMatchObject({ refusal: 'noRun' })
  })

  it('ignores a completion that races its cancel', async () => {
    const t = runnerWith()
    await t.runner.start(START)
    await t.runner.cancel()
    fire(t.drivers, 'bon-m1-1-0', {
      type: 'completed',
      terminal: 'completed',
      requestsMade: 9,
      ceilingReached: false,
      approvalsDenied: 0,
    })
    await vi.waitFor(() => {
      expect(t.updates.at(-1)?.status).toBe('cancelled')
    })
    expect(
      t.updates.at(-1)?.runAttempts.find((attempt) => attempt.attemptId === 'bon-m1-1-0')?.status,
    ).toBe('cancelled')
  })

  it('ignores late events from a superseded run', async () => {
    const t = runnerWith()
    await t.runner.start(START)
    completeAll(t.drivers, ['bon-m1-1-0', 'bon-m1-1-1', 'bon-m1-1-2'])
    await awaitCompletedRun(t.updates)
    // A new run supersedes the first; the first run's late events change nothing.
    const stale = t.drivers.get('bon-m1-1-0')
    await t.runner.start(START)
    const count = t.updates.length
    const initialRequests = t.updates.at(-1)?.runAttempts[0]?.requestsMade
    expect(initialRequests).toBe(1)
    const initialStarts = t.startCalls.length
    stale?.onEvent({
      type: 'completed',
      terminal: 'completed',
      requestsMade: 99,
      ceilingReached: false,
      approvalsDenied: 0,
    })
    await Promise.resolve(undefined)
    expect(t.updates.length).toBe(count)
    expect(t.updates.at(-1)?.runAttempts[0]?.requestsMade).toBe(initialRequests)
    expect(t.startCalls).toHaveLength(initialStarts)
  })
})

describe('winner apply brackets shared edit notices (M77/M68)', () => {
  it.each(['success', 'refused', 'failed'] as const)(
    'keeps all peer grants stale through held preflight and releases on %s',
    async (outcome) => {
      const registry = new WorkspaceEdits()
      const peers = Array.from({ length: 4 }, () => new VerifyLedger())
      for (const ledger of peers) {
        registry.add(ledger)
        ledger.record('passed', ledger.snapshot('lint', 'project'))
      }
      const entered = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      const completed: boolean[] = []
      let isPending = false
      let applies = 0
      const t = runnerWith({
        deps: {
          runGit: async (args) => {
            const command = bestOfNCommandArgs(args)
            if (command.includes('--absolute-git-dir')) return '/repo/app/.git'
            if (command[0] === 'rev-parse' || command.includes('write-tree')) return 'a'.repeat(40)
            if (command[0] === 'diff' && command[1] === '--numstat')
              return '1\t0\tscripts/check.js\n'
            if (command[0] === 'diff') return 'diff --git a/scripts/check.js b/scripts/check.js\n'
            if (isPending && command[0] === 'status') {
              entered.resolve(undefined)
              await release.promise
              if (outcome === 'refused') return ' M scripts/check.js\n'
            }
            if (command[0] === 'apply') {
              applies += 1
              expect(peers.every((ledger) => !ledger.hasCurrentRun('lint', 'project'))).toBe(true)
              if (outcome === 'failed') throw new Error('owned Git apply failed')
            }
            return ''
          },
        },
      })
      await t.runner.start(START)
      completeAll(t.drivers, ['bon-m1-1-0', 'bon-m1-1-1', 'bon-m1-1-2'])
      await awaitCompletedRun(t.updates)
      const taking = t.runner.take('bon-m1-1-0', undefined, (root, paths) => {
        expect(root).toBe('/repo/app')
        expect(paths).toEqual(['scripts/check.js'])
        const file = { relative: paths[0] ?? '', absolute: `${root}/scripts/check.js` }
        const complete = registry.beginEdit(file, paths)
        isPending = true
        return Promise.resolve((wasWritten: boolean) => {
          completed.push(wasWritten)
          if (wasWritten) peers[0]?.noteEdit(file, paths)
          complete()
          isPending = false
        })
      })
      // Attach rejection before releasing the held process boundary.
      const result = (async () => {
        try {
          return { run: await taking, error: undefined }
        } catch (error: unknown) {
          return { run: undefined, error }
        }
      })()
      try {
        await entered.promise
        const late = new VerifyLedger()
        registry.add(late)
        peers.push(late)
        for (const ledger of peers) {
          ledger.resetForMessage()
          ledger.record('passed', ledger.snapshot('lint', 'project'))
          expect(ledger.hasCurrentRun('lint', 'project')).toBe(false)
          expect(ledger.changesWhatRuns('node scripts/check.js')).toBe(true)
        }
        release.resolve(undefined)
        const settled = await result
        expect(completed).toEqual([outcome === 'success'])
        expect(applies).toBe(outcome === 'refused' ? 0 : 1)
        if (outcome === 'success') expect(settled.run?.takenBranch).toBe('best-of-n/bon-m1-1/0')
        else expect(settled.error).toBeInstanceOf(BestOfNError)
        for (const ledger of peers) {
          ledger.resetForMessage()
          ledger.record('passed', ledger.snapshot('lint', 'project'))
          expect(ledger.hasCurrentRun('lint', 'project')).toBe(true)
          expect(ledger.changesWhatRuns('node scripts/check.js')).toBe(false)
        }
      } finally {
        release.resolve(undefined)
        await result
      }
    },
  )

  it('records no owner round or write notice for an empty frozen patch', async () => {
    const t = runnerWith({
      git: (args) => (args[0] === 'rev-parse' || args.includes('write-tree') ? 'a'.repeat(40) : ''),
    })
    const begin = vi.fn(() => Promise.resolve(vi.fn()))
    await t.runner.start(START)
    completeAll(t.drivers, ['bon-m1-1-0', 'bon-m1-1-1', 'bon-m1-1-2'])
    await awaitCompletedRun(t.updates)
    await t.runner.take('bon-m1-1-0', undefined, begin)
    expect(begin).not.toHaveBeenCalled()
    expect(t.gitCalls.some((call) => call.args[0] === 'apply')).toBe(false)
  })
})
