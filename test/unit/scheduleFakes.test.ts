import { describe, expect, it } from 'vitest'
import { SCHEDULE_ACTION_CLASSES, SCHEDULE_MIN_INTERVAL_MS } from '../../src/shared/constants'
import {
  SCHEDULE_EVENT_KINDS,
  scheduleEventRunId,
  type ScheduleEventBlock,
  type ScheduleEventSource,
  type ScheduleSubscribedEventSource,
} from '../../src/shared/scheduleEvents'
import {
  scheduleFireRecordSchema,
  scheduleTimeRunId,
  type ScheduleFireRecord,
} from '../../src/shared/scheduleV2'
import { FakeScheduleApprovalStream } from './helpers/schedules/approvals'
import { FakeScheduleBackground } from './helpers/schedules/background'
import { FakeScheduleClock } from './helpers/schedules/clock'
import { FakeScheduleEventSource } from './helpers/schedules/events'
import { fakeRunContext, fakeSchedule } from './helpers/schedules/fixtures'
import { FakeScheduleHost } from './helpers/schedules/host'
import { FakeScheduleSession } from './helpers/schedules/session'
import { FakeScheduleDisk } from './helpers/schedules/store'

describe('M115 deterministic fakes', () => {
  it('requires the user’s Yes before a background registration and supports removal', async () => {
    const background = new FakeScheduleBackground()
    expect(await background.status()).toEqual({ registered: false })
    for (const choice of ['notNow', 'never'] as const) {
      await expect(background.register(100, { choice, decidedAtMs: 0 })).rejects.toThrow(
        'Explicit Yes',
      )
    }
    expect(background.registrations).toEqual([])
    await background.register(100, { choice: 'yes', decidedAtMs: 0 })
    expect(await background.status()).toEqual({ registered: true, nextWakeAtMs: 100 })
    await background.remove()
    expect(await background.status()).toEqual({ registered: false })
  })
  it('observes real IANA spring gaps and autumn folds in three zones', () => {
    const transitions = [
      {
        zone: 'America/Los_Angeles',
        spring: '2026-03-08T09:59:00Z',
        autumn: '2026-11-01T08:30:00Z',
        before: '01',
        after: '03',
        fold: '01',
      },
      {
        zone: 'Europe/Berlin',
        spring: '2026-03-29T00:59:00Z',
        autumn: '2026-10-25T00:30:00Z',
        before: '01',
        after: '03',
        fold: '02',
      },
      {
        zone: 'Australia/Sydney',
        spring: '2026-10-03T15:59:00Z',
        autumn: '2026-04-04T15:30:00Z',
        before: '01',
        after: '03',
        fold: '02',
      },
    ]
    for (const transition of transitions) {
      const gap = new FakeScheduleClock(transition.spring, transition.zone)
      expect(gap.zone()).toBe(transition.zone)
      expect(gap.localAt()).toMatchObject({ hour: transition.before, minute: '59' })
      gap.advance(SCHEDULE_MIN_INTERVAL_MS)
      expect(gap.localAt()).toMatchObject({ hour: transition.after, minute: '00' })
      const fold = new FakeScheduleClock(transition.autumn, transition.zone)
      expect(fold.localAt()).toMatchObject({ hour: transition.fold, minute: '30' })
      const first = fold.localAt()
      fold.advance(60 * SCHEDULE_MIN_INTERVAL_MS)
      expect(fold.localAt()).toEqual(first)
    }
  })

  it('keeps monotonic elapsed time independent of wall jumps, sleep and machine zones', () => {
    const clock = new FakeScheduleClock('2026-10-05T12:00:00Z')
    const start = clock.now()
    clock.advance(SCHEDULE_MIN_INTERVAL_MS)
    clock.jumpWall(-60 * SCHEDULE_MIN_INTERVAL_MS)
    clock.sleep(3 * SCHEDULE_MIN_INTERVAL_MS)
    expect(clock.monotonicNow()).toBe(SCHEDULE_MIN_INTERVAL_MS)
    expect(clock.now()).toBe(start - 56 * SCHEDULE_MIN_INTERVAL_MS)
    clock.moveToZone('Asia/Tokyo')
    expect(clock.localAt()).toMatchObject({ hour: '20', minute: '04' })
    expect(clock.now()).toBe(start - 56 * SCHEDULE_MIN_INTERVAL_MS)
    expect(() => {
      clock.advance(-1)
    }).toThrow('Monotonic')
    expect(() => new FakeScheduleClock('invalid')).toThrow('Invalid')
  })

  it.each(['museCode', 'modelApi'] as const)(
    'records steer, Stop, queued withdrawal and send on %s',
    async (backend) => {
      const session = new FakeScheduleSession(backend)
      const context = fakeRunContext()
      expect(session.sessionId).toBe('session-1')
      expect(session.isOpen()).toBe(true)
      await expect(session.steer('idle steer', context)).rejects.toThrow('idle')
      await session.send('first', context)
      expect(session.isRunning()).toBe(true)
      await session.steer('steer', context)
      await expect(session.send('busy send', context)).rejects.toThrow('running')
      const queued = await session.queue('queue', context)
      expect(session.queued.has(queued)).toBe(true)
      expect(await session.withdraw(queued)).toBe(true)
      expect(await session.withdraw(queued)).toBe(false)
      await session.cancel()
      await session.send('after Stop', context)
      expect(session.calls.map((call) => call.kind)).toEqual([
        'send',
        'steer',
        'queue',
        'withdraw',
        'withdraw',
        'cancel',
        'send',
      ])
      expect(session.calls[1]).toMatchObject({ prompt: 'steer', context: { unattended: true } })
    },
  )

  it('shares claims across two processes, crashes, restarts and time/event occurrences', async () => {
    const disk = new FakeScheduleDisk()
    const first = disk.client()
    const second = disk.client()
    const job = fakeSchedule()
    await first.create(job)
    expect(await second.list(job.workspaceKey)).toEqual([job])
    await expect(
      second.create(fakeSchedule({ id: 'nonzero-revision', revision: 1 })),
    ).rejects.toThrow('revision must be zero')
    expect(await second.list('other-workspace')).toEqual([])
    await expect(second.create(job)).rejects.toThrow('exists')
    const runId = scheduleTimeRunId(job.id, job.nextFireAtMs!)
    expect(await Promise.all([first.claim(runId), second.claim(runId)])).toEqual([true, false])
    // The admitted process crashes before send; a new client cannot replay.
    expect(await disk.client().claim(runId)).toBe(false)
    const eventRunId = scheduleEventRunId(job.id, { source: 'github', eventKey: 'pr-1' })
    expect(await second.claim(eventRunId)).toBe(true)
    expect(await disk.client().claim(eventRunId)).toBe(false)
    const result = await second.list(job.workspaceKey)
    result[0]!.name = 'Mutated snapshot'
    const original = await first.list(job.workspaceKey)
    expect(original[0]?.name).toBe(job.name)
    expect(await second.update({ ...job, paused: true })).toBe(true)
    const updated = await first.list(job.workspaceKey)
    expect(updated[0]?.paused).toBe(true)
    expect(await first.remove(job.workspaceKey, job.id)).toBe(true)
    expect(await second.update(job)).toBe(false)
    expect(await disk.client().claim(runId)).toBe(false)
  })

  it('shares fire records and records deliveries through the injected host', async () => {
    const clock = new FakeScheduleClock('2026-10-05T12:00:00Z')
    const host = new FakeScheduleHost(clock)
    const schedule = fakeSchedule()
    expect(host.holds(schedule.workspaceKey)).toBe(false)
    host.workspaces.add(schedule.workspaceKey)
    expect(host.holds(schedule.workspaceKey)).toBe(true)
    expect(host.now()).toBe(clock.now())
    expect(host.monotonicNow()).toBe(clock.monotonicNow())
    const record = await host.deliver(schedule, fakeRunContext(schedule), clock.now())
    expect(record).toMatchObject({
      outcome: 'ran',
    })
    expect(host.deliveries).toHaveLength(1)
    const disk = new FakeScheduleDisk()
    await disk.client().record(record)
    expect(await disk.client().fires(schedule.workspaceKey)).toEqual([record])
    expect(await disk.client().fires('other-workspace')).toEqual([])
  })

  it('delivers complete run-scoped settlements including refusals, cost certainty and liability', async () => {
    const clock = new FakeScheduleClock('2026-10-05T12:00:00Z')
    const host = new FakeScheduleHost(clock)
    const schedule = fakeSchedule()
    const context = fakeRunContext(schedule)
    const event = {
      source: 'manual',
      eventKey: 'poke-1',
      kind: 'manual',
      observedAt: clock.now(),
      fields: {},
    } as const
    const free = await host.deliver(schedule, context, clock.now(), event)
    expect(scheduleFireRecordSchema.safeParse(free).success).toBe(true)
    expect(free).toEqual({
      runId: context.runId,
      scheduleId: schedule.id,
      workspaceKey: schedule.workspaceKey,
      occurrenceMs: clock.now(),
      observedAtMs: clock.now(),
      target: schedule.target,
      delivery: schedule.delivery,
      outcome: 'ran',
      refusedActions: [],
      cost: { usd: 0, certainty: 'exact', retainedLiabilityUsd: 0 },
      event,
    })
    host.result = {
      ...free,
      runId: `${context.runId}:second`,
      refusedActions: [{ actionClass: 'shell', tool: 'shell', reason: 'outsideGrant' }],
      cost: { usd: 0.1, certainty: 'estimated', retainedLiabilityUsd: 0.2 },
    }
    const paid = await host.deliver(
      schedule,
      { ...context, runId: host.result.runId },
      clock.now(),
      event,
    )
    expect(await host.deliver(schedule, context, clock.now(), event)).toEqual(free)
    const disk = new FakeScheduleDisk()
    await disk.client().record(paid)
    expect(await disk.client().fires(schedule.workspaceKey)).toEqual([host.result])
  })

  it.each(['museCode', 'modelApi'] as const)(
    'settles queued and steered delivery only when each run finishes on %s',
    async (backend) => {
      const clock = new FakeScheduleClock('2026-10-05T12:00:00Z')
      const host = new FakeScheduleHost(clock)
      host.deferSettlements = true
      const queued = fakeSchedule({
        delivery: 'queue',
        target: { kind: 'conversation', backend, sessionId: 'session-1' },
      })
      const steered = fakeSchedule({ id: 'schedule-2', delivery: 'steer', target: queued.target })
      const queueContext = fakeRunContext(queued)
      const steerContext = fakeRunContext(steered)
      let queueResult: ScheduleFireRecord | undefined
      let steerResult: ScheduleFireRecord | undefined
      const queuePromise = (async () => {
        queueResult = await host.deliver(queued, queueContext, clock.now())
      })()
      const steerPromise = (async () => {
        steerResult = await host.deliver(steered, steerContext, clock.now())
      })()
      await Promise.resolve()
      expect(queueResult).toBeUndefined()
      expect(steerResult).toBeUndefined()
      await expect(host.deliver(queued, queueContext, clock.now())).rejects.toThrow(
        'already pending',
      )
      const record: ScheduleFireRecord = {
        runId: queueContext.runId,
        scheduleId: queued.id,
        workspaceKey: queued.workspaceKey,
        occurrenceMs: clock.now(),
        observedAtMs: clock.now(),
        target: queued.target,
        delivery: queued.delivery,
        outcome: 'ran',
        refusedActions: [{ actionClass: 'shell', tool: 'shell', reason: 'outsideGrant' }],
        cost: { usd: 0.1, certainty: 'unknown', retainedLiabilityUsd: 0.2 },
      }
      host.settle(record)
      await queuePromise
      expect(queueResult).toEqual(record)
      expect(steerResult).toBeUndefined()
      const failed: ScheduleFireRecord = {
        ...record,
        runId: steerContext.runId,
        scheduleId: steered.id,
        delivery: 'steer',
        outcome: 'failed',
        reason: 'turnFailed',
      }
      host.settle(failed)
      await steerPromise
      expect(steerResult).toEqual(failed)
      expect(() => {
        host.settle(failed)
      }).toThrow('No pending')
      expect(host.pending.size).toBe(0)
    },
  )

  it('rejects stale whole-record updates after grant, consent and pause revocation', async () => {
    const disk = new FakeScheduleDisk()
    const first = disk.client()
    const second = disk.client()
    const job = fakeSchedule({
      grant: {
        rules: [{ id: 'command-1', kind: 'command', prefix: 'npm' }],
        destinationIds: [],
        paidCapUsd: 1,
      },
      paidCapUsd: 1,
      paidConsent: {
        modelId: 'model-1',
        accountId: 'digest',
        priceTier: 'tier-1',
        grantedAtMs: 0,
        dailyCapUsd: 1,
        sharedDailyBudgetUsd: 1,
        extras: [],
      },
    })
    await first.create(job)
    const [stale] = await first.list(job.workspaceKey)
    const { paidConsent: _consent, ...revoked } = job
    expect(
      await second.update({
        ...revoked,
        paused: true,
        grant: { rules: [], destinationIds: [], paidCapUsd: 0 },
        paidCapUsd: 0,
      }),
    ).toBe(true)
    expect(
      await first.update({ ...stale!, fireCount: 1, updatedAtMs: job.updatedAtMs + 100 }),
    ).toBe(false)
    const [current] = await disk.client().list(job.workspaceKey)
    expect(current).toMatchObject({
      revision: 1,
      paused: true,
      grant: { rules: [] },
      paidCapUsd: 0,
      fireCount: 0,
    })
    expect(current).not.toHaveProperty('paidConsent')
    expect(await first.update({ ...current!, fireCount: 1 })).toBe(true)
    const [afterRetry] = await second.list(job.workspaceKey)
    expect(afterRetry).toMatchObject({
      revision: 2,
      paused: true,
      grant: { rules: [] },
      fireCount: 1,
    })
    const [fresh] = await first.list(job.workspaceKey)
    expect(
      await Promise.all([
        first.update({ ...fresh!, name: 'First edit' }),
        second.update({ ...fresh!, name: 'Second edit' }),
      ]),
    ).toEqual([true, false])
    expect(await first.remove(job.workspaceKey, job.id)).toBe(true)
    await expect(disk.client().create(fakeSchedule({ id: job.id }))).rejects.toThrow('exists')
    expect(await second.update(job)).toBe(false)
  })

  it.each(SCHEDULE_EVENT_KINDS)('provides a source, history and replay for %s', async (kind) => {
    const source = new FakeScheduleEventSource(`fake-${kind}`, kind)
    const port: ScheduleEventSource = source
    expect(port.capability()).toEqual({ available: true })
    const emitted = source.emit('event-1', 100, { status: 'done' })
    const block: ScheduleEventBlock = { type: 'scheduleEvent', trust: 'untrusted', event: emitted }
    expect(block.event.kind).toBe(kind)
    expect(await source.poll(100)).toEqual([emitted])
    expect(source.polls).toEqual([100])
    expect(await source.poll(101)).toEqual([])
    expect(await source.history({ fromMs: 100, toMs: 101 })).toEqual({
      available: true,
      events: [emitted],
    })
    expect(await source.history({ fromMs: 0, toMs: 100 })).toEqual({ available: true, events: [] })
    source.keepsHistory = false
    expect(await source.history({ fromMs: 0, toMs: 101 })).toMatchObject({ available: false })
    source.availability = { available: false, reason: 'Milestone not bound' }
    expect(source.capability()).toEqual(source.availability)
    await expect(source.poll(0)).rejects.toThrow('not bound')
  })

  it('also admits a subscription source with explicit disposal', () => {
    const listeners = new Set<Parameters<ScheduleSubscribedEventSource['subscribe']>[0]>()
    const source: ScheduleSubscribedEventSource = {
      id: 'manual',
      kinds: ['manual'],
      capability: () => ({ available: true }),
      history: () => Promise.resolve({ available: false, reason: 'No history' }),
      subscribe: (listener) => {
        listeners.add(listener)
        return {
          dispose: () => {
            listeners.delete(listener)
          },
        }
      },
    }
    const port: ScheduleEventSource = source
    const subscription = port.subscribe(() => undefined)
    expect(listeners.size).toBe(1)
    subscription.dispose()
    expect(listeners.size).toBe(0)
  })

  it.each(['museCode', 'modelApi'] as const)(
    'keeps every approval class observable on %s',
    (backend) => {
      const approvals = new FakeScheduleApprovalStream(backend)
      expect(approvals.backend).toBe(backend)
      const actions = approvals.requestEveryClass()
      expect(actions.map((action) => action.class)).toEqual(SCHEDULE_ACTION_CLASSES)
      expect(() => {
        approvals.assertSettled()
      }).toThrow('still pending')
      for (const action of actions) approvals.decide(action.id, false)
      approvals.assertSettled()
      expect(approvals.decisions).toHaveLength(SCHEDULE_ACTION_CLASSES.length)
      const shell = approvals.request('shell')
      approvals.decide(shell.id, true, 'command-1')
      expect(approvals.decisions.at(-1)).toEqual({ id: shell.id, allow: true, ruleId: 'command-1' })
      expect(() => {
        approvals.decide('unknown', false)
      }).toThrow('Unknown')
    },
  )

  it.each(['museCode', 'modelApi'] as const)(
    'keeps repeated shell approvals pending independently on %s',
    (backend) => {
      const approvals = new FakeScheduleApprovalStream(backend)
      const first = approvals.request('shell')
      const second = approvals.request('shell')
      expect(first.id).not.toBe(second.id)
      expect(approvals.pending.size).toBe(2)
      approvals.decide(first.id, false)
      expect(approvals.pending.get(second.id)).toEqual(second)
      expect(() => {
        approvals.assertSettled()
      }).toThrow('still pending')
      approvals.decide(second.id, true, 'command-1')
      approvals.assertSettled()
      expect(approvals.request('shell').id).not.toBe(first.id)
    },
  )
})
