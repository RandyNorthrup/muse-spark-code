import { describe, expect, it, vi } from 'vitest'
import { SteerRefusedError } from '../../src/core/agent/agentBackend'
import {
  ScheduleDelivery,
  type ScheduleDeliverySession,
  type ScheduleDeliveryRuns,
  type ScheduleRunSettlement,
  type ScheduleTargetLease,
} from '../../src/core/schedules/delivery'
import { SCHEDULE_EVENT_FIELD_MAX_CHARS, UI_TEXT } from '../../src/shared/constants'
import type { ScheduleEvent } from '../../src/shared/scheduleEvents'
import type { ScheduleRunContext, ScheduleV2 } from '../../src/shared/scheduleV2'
import { fakeRunContext, fakeSchedule } from './helpers/schedules/fixtures'
import { FakeScheduleSession } from './helpers/schedules/session'

const occurrenceMs = Date.parse('2026-10-06T12:00:00Z')
const facts: ScheduleRunSettlement = {
  outcome: 'ran',
  refusedActions: [{ actionClass: 'shell', tool: 'shell', reason: 'Outside the grant' }],
  cost: { usd: 0.1, certainty: 'estimated', retainedLiabilityUsd: 0.2 },
}

class DeliverySession extends FakeScheduleSession implements ScheduleDeliverySession {
  private readonly idle = new Set<(isIdle: boolean) => void>()
  waitUntilIdle(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted || !this.open) return Promise.resolve(false)
    if (!this.running) return Promise.resolve(true)
    return new Promise((resolve) => {
      const done = (isIdle: boolean): void => {
        this.idle.delete(done)
        signal.removeEventListener('abort', aborted)
        resolve(isIdle)
      }
      const aborted = (): void => {
        done(false)
      }
      this.idle.add(done)
      signal.addEventListener('abort', aborted, { once: true })
    })
  }
  idleNow(): void {
    this.running = false
    for (const done of this.idle) done(this.open)
  }
  override cancel(): Promise<void> {
    this.calls.push({ kind: 'cancel' })
    return Promise.resolve(undefined)
  }
}

function setup(backend: 'museCode' | 'modelApi', overrides: Partial<ScheduleV2> = {}) {
  const schedule = fakeSchedule({
    target: { kind: 'conversation', backend, sessionId: 'session-1' },
    ...overrides,
  })
  const context = fakeRunContext(schedule)
  const session = new DeliverySession(backend)
  const release = vi.fn(() => Promise.resolve(undefined))
  const lease: ScheduleTargetLease = { session, release }
  const freshSession = new DeliverySession(backend, 'fresh-session')
  const freshRelease = vi.fn(() => Promise.resolve(undefined))
  const targets = {
    find: vi.fn((): Promise<ScheduleTargetLease | undefined> => Promise.resolve(lease)),
    open: vi.fn((): Promise<ScheduleTargetLease> => {
      session.open = true
      return Promise.resolve(lease)
    }),
    fresh: vi.fn((): Promise<ScheduleTargetLease> =>
      Promise.resolve({ session: freshSession, release: freshRelease }),
    ),
  }
  const started = vi.fn()
  const terminal = Promise.withResolvers<ScheduleRunSettlement>()
  const failure: ScheduleRunSettlement = { ...facts, outcome: 'failed', reason: 'Dispatch failed' }
  const runs = {
    run: vi.fn<ScheduleDeliveryRuns['run']>(async (_session, _schedule, _context, dispatch) => {
      try {
        await dispatch()
      } catch {
        return failure
      }
      started()
      return await terminal.promise
    }),
  }
  let isWorkspaceHeld = true
  const prompt = vi.fn((input: ScheduleV2, _event?: ScheduleEvent) =>
    input.action.kind === 'prompt' ? input.action.prompt : 'unexpected report',
  )
  const delivery = new ScheduleDelivery({
    now: () => occurrenceMs + 1,
    monotonicNow: () => 100,
    holds: () => isWorkspaceHeld,
    targets,
    runs,
    prompt,
  })
  const deliver = () => delivery.deliver(schedule, context, occurrenceMs)
  return {
    schedule,
    context,
    session,
    targets,
    freshSession,
    release,
    freshRelease,
    runs,
    started,
    terminal,
    failure,
    delivery,
    deliver,
    prompt,
    dropWorkspace: () => {
      isWorkspaceHeld = false
    },
  }
}

function beginHold(rig: ReturnType<typeof setup>) {
  rig.session.running = true
  const waiting = vi.spyOn(rig.session, 'waitUntilIdle')
  const pending = rig.deliver()
  return {
    pending,
    observed: () =>
      vi.waitFor(() => {
        expect(waiting).toHaveBeenCalledOnce()
      }),
  }
}

async function settleStarted(
  rig: ReturnType<typeof setup>,
  pending: ReturnType<ScheduleDelivery['deliver']>,
) {
  await vi.waitFor(() => {
    expect(rig.started).toHaveBeenCalledOnce()
  })
  rig.terminal.resolve(facts)
  return await pending
}

describe.each(['museCode', 'modelApi'] as const)('%s schedule delivery', (backend) => {
  it.each([true, false])(
    'steers when running=%s and waits for run-scoped settlement',
    async (running) => {
      const rig = setup(backend, { delivery: 'steer' })
      rig.session.running = running
      const pending = rig.deliver()
      await vi.waitFor(() => {
        expect(rig.started).toHaveBeenCalledOnce()
      })
      expect(rig.session.calls.map((call) => call.kind)).toEqual([running ? 'steer' : 'send'])
      expect(rig.release).not.toHaveBeenCalled()
      rig.terminal.resolve(facts)
      expect(await pending).toMatchObject({ ...facts, runId: rig.context.runId, occurrenceMs })
      expect(rig.release).toHaveBeenCalledOnce()
    },
  )

  it('falls back only after an explicit no-input steer refusal', async () => {
    const rig = setup(backend, { delivery: 'steer' })
    rig.session.running = true
    vi.spyOn(rig.session, 'steer').mockImplementation(() => {
      rig.session.running = false
      return Promise.reject(new SteerRefusedError('No turn took this input'))
    })
    const pending = rig.deliver()
    await settleStarted(rig, pending)
    expect(rig.session.calls.map((call) => call.kind)).toEqual(['send'])
  })

  it('never retries an uncertain steer and retains failed-run liability', async () => {
    const rig = setup(backend, { delivery: 'steer' })
    rig.session.running = true
    rig.terminal.resolve(facts)
    vi.spyOn(rig.session, 'steer').mockImplementation(() => {
      rig.session.running = false
      return Promise.reject(new Error('Ack lost after dispatch'))
    })
    expect(await rig.deliver()).toMatchObject(rig.failure)
    expect(rig.session.calls).toEqual([])
  })

  it('refuses a steer fallback after losing workspace ownership', async () => {
    const rig = setup(backend, { delivery: 'steer' })
    const refusal = Promise.withResolvers<undefined>()
    const steered = vi.spyOn(rig.session, 'steer').mockImplementation(() => refusal.promise)
    rig.session.running = true
    const pending = rig.deliver()
    await vi.waitFor(() => {
      expect(steered).toHaveBeenCalledOnce()
    })
    rig.dropWorkspace()
    rig.session.running = false
    refusal.reject(new SteerRefusedError('No turn took this input'))
    rig.terminal.resolve(facts)
    expect(await pending).toMatchObject(rig.failure)
    expect(rig.session.calls).toEqual([])
  })

  it('interrupt uses Stop and waits for the aborted turn to unwind', async () => {
    const rig = setup(backend, { delivery: 'interrupt' })
    rig.session.running = true
    const stopped = vi.fn()
    vi.spyOn(rig.session, 'cancel').mockImplementation(() => {
      rig.session.calls.push({ kind: 'cancel' })
      stopped()
      return Promise.resolve(undefined)
    })
    const pending = rig.deliver()
    await vi.waitFor(() => {
      expect(stopped).toHaveBeenCalledOnce()
    })
    expect(rig.session.calls.map((call) => call.kind)).toEqual(['cancel'])
    rig.session.idleNow()
    await settleStarted(rig, pending)
    expect(rig.session.calls.map((call) => call.kind)).toEqual(['cancel', 'send'])
  })

  it('queues a withdrawable backend message and keeps its settlement pending', async () => {
    const rig = setup(backend, { delivery: 'queue' })
    rig.session.running = true
    let isSettled = false
    const pending = (async () => {
      const result = await rig.deliver()
      isSettled = true
      return result
    })()
    await vi.waitFor(() => {
      expect(rig.started).toHaveBeenCalledOnce()
    })
    expect(isSettled).toBe(false)
    expect(await rig.delivery.withdraw(rig.context.runId)).toBe(true)
    expect(rig.session.calls.map((call) => call.kind)).toEqual(['queue', 'withdraw'])
    rig.terminal.resolve({ ...facts, outcome: 'skipped', reason: UI_TEXT.turnUnqueued })
    expect(await pending).toMatchObject({ outcome: 'skipped', cost: facts.cost })
    expect(await rig.delivery.withdraw(rig.context.runId)).toBe(false)
  })

  it('when idle holds without a backend queue and sends only after idle', async () => {
    const rig = setup(backend)
    const held = beginHold(rig)
    const pending = held.pending
    await held.observed()
    expect(rig.session.calls).toEqual([])
    expect(rig.runs.run).not.toHaveBeenCalled()
    rig.session.idleNow()
    await settleStarted(rig, pending)
    expect(rig.session.calls.map((call) => call.kind)).toEqual(['send'])
    expect(rig.delivery.skip(rig.context.runId)).toBe(false)
  })

  it('Skip withdraws an idle hold without stopping the user or spending', async () => {
    const rig = setup(backend)
    rig.session.running = true
    const waiting = vi.fn()
    vi.spyOn(rig.session, 'waitUntilIdle').mockImplementation((signal) => {
      waiting()
      return new Promise((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            resolve(false)
          },
          { once: true },
        )
      })
    })
    const pending = rig.deliver()
    await vi.waitFor(() => {
      expect(waiting).toHaveBeenCalledOnce()
    })
    expect(rig.delivery.skip(rig.context.runId)).toBe(true)
    expect(await pending).toMatchObject({
      outcome: 'missed',
      cost: { usd: 0, certainty: 'exact', retainedLiabilityUsd: 0 },
    })
    expect(rig.session.calls).toEqual([])
    expect(rig.runs.run).not.toHaveBeenCalled()
    expect(rig.release).toHaveBeenCalledOnce()
  })

  it('creates a fresh session instead of disturbing the target', async () => {
    const rig = setup(backend, { delivery: 'newConversation', parallel: true })
    rig.session.running = true
    const pending = rig.deliver()
    await settleStarted(rig, pending)
    expect(rig.targets.fresh).toHaveBeenCalledWith(rig.schedule, occurrenceMs)
    expect(rig.targets.find).not.toHaveBeenCalled()
    expect(rig.freshSession.calls.map((call) => call.kind)).toEqual(['send'])
    expect(rig.session.calls).toEqual([])
    expect(rig.freshRelease).toHaveBeenCalledOnce()
  })

  it.each(['open', 'skip'] as const)('handles a closed target with %s', async (whenClosed) => {
    const rig = setup(backend, { whenClosed })
    rig.session.open = false
    rig.terminal.resolve(facts)
    const pending = rig.deliver()
    if (whenClosed === 'open') {
      await vi.waitFor(() => {
        expect(rig.started).toHaveBeenCalledOnce()
      })
      rig.terminal.resolve(facts)
    }
    const result = await pending
    expect(result.outcome).toBe(whenClosed === 'open' ? 'ran' : 'missed')
    expect(rig.targets.open).toHaveBeenCalledTimes(whenClosed === 'open' ? 1 : 0)
    expect(rig.runs.run).toHaveBeenCalledTimes(whenClosed === 'open' ? 1 : 0)
  })

  it.each(['runOnce', 'skip'] as const)(
    'applies the %s catch-up policy to the selected missed occurrence',
    async (catchUp) => {
      const rig = setup(backend, { catchUp })
      rig.terminal.resolve(facts)
      const pending = rig.delivery.deliverMissed(rig.schedule, rig.context, occurrenceMs)
      if (catchUp === 'runOnce') {
        await vi.waitFor(() => {
          expect(rig.started).toHaveBeenCalledOnce()
        })
        rig.terminal.resolve(facts)
      }
      const result = await pending
      expect(result.outcome).toBe(catchUp === 'runOnce' ? 'ran' : 'missed')
      expect(rig.runs.run).toHaveBeenCalledTimes(catchUp === 'runOnce' ? 1 : 0)
    },
  )

  it('never dispatches after losing the workspace while an idle fire waits', async () => {
    const rig = setup(backend)
    const held = beginHold(rig)
    const pending = held.pending
    await held.observed()
    rig.terminal.resolve(facts)
    rig.dropWorkspace()
    rig.session.idleNow()
    const result = await pending
    expect(result.outcome).toBe('missed')
    expect(rig.runs.run).not.toHaveBeenCalled()
  })

  it('refuses a mismatched run grant before resolving a target', async () => {
    const rig = setup(backend)
    rig.terminal.resolve(facts)
    const context: ScheduleRunContext = {
      ...rig.context,
      grant: { ...rig.context.grant, paidCapUsd: 1 },
    }
    await expect(rig.delivery.deliver(rig.schedule, context, occurrenceMs)).rejects.toThrow(
      UI_TEXT.scheduleInvalid,
    )
    expect(rig.targets.find).not.toHaveBeenCalled()
  })

  it('keeps an admitted grant snapshot while the caller changes its copy', async () => {
    const rig = setup(backend)
    const held = beginHold(rig)
    const pending = held.pending
    await held.observed()
    rig.schedule.grant.paidCapUsd = 1
    rig.context.grant.paidCapUsd = 1
    rig.session.idleNow()
    await settleStarted(rig, pending)
    expect(rig.runs.run.mock.calls[0]?.[2].grant.paidCapUsd).toBe(0)
  })

  it.each([false, true])(
    'retains a frozen event snapshot when caller mutation is invalid=%s',
    async (invalid) => {
      const rig = setup(backend)
      const event: ScheduleEvent = {
        source: 'git',
        eventKey: 'event-A',
        kind: 'branchUpdated',
        fields: { branch: 'main' },
        observedAt: occurrenceMs,
      }
      const expected = structuredClone(event)
      const lookup = Promise.withResolvers<ScheduleTargetLease | undefined>()
      rig.targets.find.mockReturnValueOnce(lookup.promise)
      const pending = rig.delivery.deliver(rig.schedule, rig.context, occurrenceMs, event)
      event.eventKey = 'event-B'
      event.fields['branch'] = invalid
        ? 'x'.repeat(SCHEDULE_EVENT_FIELD_MAX_CHARS + 1)
        : 'other-branch'
      lookup.resolve({ session: rig.session, release: rig.release })
      const result = await settleStarted(rig, pending)
      expect(rig.prompt.mock.calls[0]?.[1]).toEqual(expected)
      expect(Object.isFrozen(rig.prompt.mock.calls[0]?.[1])).toBe(true)
      expect(Object.isFrozen(rig.prompt.mock.calls[0]?.[1]?.fields)).toBe(true)
      expect(result.event).toEqual(expected)
    },
  )

  it('refuses a duplicate idle hold without replacing the first run’s skip handle', async () => {
    const rig = setup(backend)
    rig.session.running = true
    const waiting = vi.spyOn(rig.session, 'waitUntilIdle')
    rig.terminal.resolve(facts)
    const first = rig.deliver()
    void first.catch(() => undefined)
    await vi.waitFor(() => {
      expect(waiting).toHaveBeenCalledOnce()
    })
    const second = rig.deliver()
    void second.catch(() => undefined)
    try {
      await vi.waitFor(() => {
        expect(rig.release).toHaveBeenCalledOnce()
      })
      await expect(second).rejects.toThrow(UI_TEXT.scheduleAlreadyRun)
      expect(rig.delivery.skip(rig.context.runId)).toBe(true)
      expect(await first).toMatchObject({ outcome: 'missed' })
    } finally {
      rig.delivery.skip(rig.context.runId)
      rig.session.idleNow()
    }
  })

  it('does not even resolve a target without workspace ownership', async () => {
    const rig = setup(backend)
    rig.dropWorkspace()
    expect(await rig.deliver()).toMatchObject({ outcome: 'missed', cost: { usd: 0 } })
    expect(rig.targets.find).not.toHaveBeenCalled()
  })

  it('rechecks workspace ownership after unattended admission waits', async () => {
    const rig = setup(backend)
    rig.runs.run.mockImplementation(async (_session, _schedule, _context, dispatch) => {
      rig.dropWorkspace()
      try {
        await dispatch()
        return facts
      } catch {
        return rig.failure
      }
    })
    expect(await rig.deliver()).toMatchObject(rig.failure)
    expect(rig.session.calls).toEqual([])
  })

  it('sends nothing after losing the workspace while Stop unwinds', async () => {
    const rig = setup(backend, { delivery: 'interrupt' })
    rig.session.running = true
    rig.terminal.resolve(facts)
    const stopped = vi.spyOn(rig.session, 'cancel')
    const pending = rig.deliver()
    await vi.waitFor(() => {
      expect(stopped).toHaveBeenCalledOnce()
    })
    rig.dropWorkspace()
    rig.session.idleNow()
    expect(await pending).toMatchObject(rig.failure)
    expect(rig.session.calls.map((call) => call.kind)).toEqual(['cancel'])
  })

  it('rejects invalid occurrences before opening the target', async () => {
    const rig = setup(backend)
    rig.terminal.resolve(facts)
    await expect(rig.delivery.deliver(rig.schedule, rig.context, -1)).rejects.toThrow()
    expect(rig.targets.find).not.toHaveBeenCalled()
  })

  it('never substitutes another backend or conversation', async () => {
    const rig = setup(backend)
    rig.terminal.resolve(facts)
    rig.targets.find.mockResolvedValue({ session: rig.freshSession, release: rig.freshRelease })
    await expect(rig.deliver()).rejects.toThrow(UI_TEXT.scheduleV2.messages.targetUnavailable)
    expect(rig.runs.run).not.toHaveBeenCalled()
    expect(rig.freshRelease).toHaveBeenCalledOnce()
  })

  it('keeps a target-open failure explicit and sends nothing', async () => {
    const rig = setup(backend)
    rig.targets.find.mockResolvedValue(undefined)
    rig.targets.open.mockRejectedValue(new Error('Unable to resume'))
    expect(await rig.deliver()).toMatchObject({
      outcome: 'failed',
      reason: UI_TEXT.scheduleCommandFailed,
    })
    expect(rig.runs.run).not.toHaveBeenCalled()
  })

  it('propagates a settlement failure instead of fabricating a free success', async () => {
    const rig = setup(backend)
    rig.runs.run.mockRejectedValue(new Error('Accounting unavailable'))
    await expect(rig.deliver()).rejects.toThrow('Accounting unavailable')
    expect(rig.release).toHaveBeenCalledOnce()
  })
})

describe('board and report bindings', () => {
  it.each(['role', 'team', 'worker', 'node'] as const)(
    'refuses an unavailable %s target explicitly',
    async (kind) => {
      const targets = {
        role: { kind: 'role', teamId: 'team-1', roleId: 'reader' },
        team: { kind: 'team', teamId: 'team-1' },
        worker: { kind: 'worker', workerId: 'worker-1' },
        node: { kind: 'node', nodeId: 'node-1' },
      } satisfies Record<string, ScheduleV2['target']>
      const rig = setup('modelApi', { target: targets[kind] })
      expect(await rig.deliver()).toMatchObject({
        outcome: 'refused',
        reason: UI_TEXT.scheduleV2.messages.targetUnavailable,
      })
      expect(rig.targets.find).not.toHaveBeenCalled()
    },
  )

  it.each(['role', 'team'] as const)(
    'hands %s work to the board under the original grant and awaits final settlement',
    async (kind) => {
      const rig = setup('modelApi', {
        target:
          kind === 'role'
            ? { kind, teamId: 'team-1', roleId: 'reader' }
            : { kind, teamId: 'team-1' },
      })
      const terminal = Promise.withResolvers<Awaited<ReturnType<ScheduleDelivery['deliver']>>>()
      const board = { deliver: vi.fn(() => terminal.promise) }
      const delivery = new ScheduleDelivery({
        now: () => occurrenceMs + 1,
        monotonicNow: () => 1,
        holds: () => true,
        targets: rig.targets,
        runs: rig.runs,
        prompt: rig.prompt,
        board,
      })
      const pending = delivery.deliver(rig.schedule, rig.context, occurrenceMs)
      expect(board.deliver).toHaveBeenCalledWith(rig.schedule, rig.context, occurrenceMs, undefined)
      expect(rig.targets.find).not.toHaveBeenCalled()
      terminal.resolve({
        ...facts,
        runId: rig.context.runId,
        scheduleId: rig.schedule.id,
        workspaceKey: rig.schedule.workspaceKey,
        occurrenceMs,
        observedAtMs: occurrenceMs,
        target: rig.schedule.target,
        delivery: rig.schedule.delivery,
      })
      expect(await pending).toMatchObject({
        cost: facts.cost,
        refusedActions: facts.refusedActions,
      })
    },
  )

  it('rejects another run’s board settlement rather than relabelling its accounting', async () => {
    const rig = setup('modelApi', { target: { kind: 'team', teamId: 'team-1' } })
    const board = {
      deliver: vi.fn(() =>
        Promise.resolve({
          ...facts,
          runId: 'another-run',
          scheduleId: rig.schedule.id,
          workspaceKey: rig.schedule.workspaceKey,
          occurrenceMs,
          observedAtMs: occurrenceMs,
          target: rig.schedule.target,
          delivery: rig.schedule.delivery,
        }),
      ),
    }
    const delivery = new ScheduleDelivery({
      now: () => occurrenceMs,
      monotonicNow: () => 1,
      holds: () => true,
      targets: rig.targets,
      runs: rig.runs,
      prompt: rig.prompt,
      board,
    })
    await expect(delivery.deliver(rig.schedule, rig.context, occurrenceMs)).rejects.toThrow(
      UI_TEXT.scheduleInvalid,
    )
  })

  it('accepts identical external event values with reordered field keys', async () => {
    const rig = setup('modelApi', { target: { kind: 'team', teamId: 'team-1' } })
    const event: ScheduleEvent = {
      source: 'git',
      eventKey: 'merged',
      kind: 'pullRequestMerged',
      fields: { status: 'merged', branch: 'main' },
      observedAt: occurrenceMs,
    }
    const board = {
      deliver: vi.fn(() =>
        Promise.resolve({
          ...facts,
          runId: rig.context.runId,
          scheduleId: rig.schedule.id,
          workspaceKey: rig.schedule.workspaceKey,
          occurrenceMs,
          observedAtMs: occurrenceMs,
          target: rig.schedule.target,
          delivery: rig.schedule.delivery,
          event: { ...event, fields: { branch: 'main', status: 'merged' } },
        }),
      ),
    }
    const delivery = new ScheduleDelivery({
      now: () => occurrenceMs,
      monotonicNow: () => 1,
      holds: () => true,
      targets: rig.targets,
      runs: rig.runs,
      prompt: rig.prompt,
      board,
    })
    expect(await delivery.deliver(rig.schedule, rig.context, occurrenceMs, event)).toMatchObject({
      ...facts,
      event,
    })
  })

  it('refuses an unbound report without a model submission or reservation', async () => {
    const rig = setup('modelApi', {
      action: {
        kind: 'report',
        reportKind: 'schedules',
        args: {},
        format: 'markdown',
        destinations: [
          { kind: 'browser', id: 'browser-1', location: 'local', whenInactive: 'wait' },
        ],
      },
    })
    expect(await rig.deliver()).toMatchObject({ outcome: 'refused', cost: { usd: 0 } })
    expect(rig.targets.find).not.toHaveBeenCalled()
    expect(rig.prompt).not.toHaveBeenCalled()
    expect(rig.runs.run).not.toHaveBeenCalled()
  })
})
