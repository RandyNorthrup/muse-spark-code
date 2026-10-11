import { describe, expect, it, vi } from 'vitest'
import { scheduleEventRunId, type ScheduleEvent } from '../../src/shared/scheduleEvents'
import { Usd } from '../../src/shared/usd'
import { createScheduler } from '../../src/core/schedules/scheduler'
import { createScheduleStore } from '../../src/core/schedules/store'
import { SCHEDULE_DELIVERIES, UI_TEXT } from '../../src/shared/constants'
import {
  noScheduleCost,
  type ScheduleFireRecord,
  type ScheduleV2,
} from '../../src/shared/scheduleV2'
import { MemoryScheduleFs } from './helpers/schedules/storage'
import { fakeSchedule } from './helpers/schedules/fixtures'

// Every production delivery enum participates, plus host-specific entry paths.
const kinds = [...SCHEDULE_DELIVERIES, 'background', 'run-now', 'native queue promotion'] as const
const exits = [
  'returned',
  'refused',
  'threw',
  'aborted',
  'window closed',
  'session closed',
  'runtime closed',
  'host process ending',
  'cost read failed',
] as const

function terminal(schedule: ScheduleV2, runId: string, occurrenceMs: number): ScheduleFireRecord {
  return {
    scheduleId: schedule.id,
    workspaceKey: schedule.workspaceKey,
    target: schedule.target,
    delivery: schedule.delivery,
    runId,
    occurrenceMs,
    observedAtMs: occurrenceMs,
    outcome: 'ran',
    refusedActions: [],
    cost: noScheduleCost(),
  }
}

describe('scheduler settlement ownership across every exit and entry', () => {
  it.each(kinds.flatMap((kind) => exits.map((exit) => ({ kind, exit }))))(
    'journals $exit for $kind, drains next fire and never replays after reload',
    async ({ kind, exit }) => {
      const fs = new MemoryScheduleFs()
      const store = createScheduleStore(fs)
      const delivery =
        SCHEDULE_DELIVERIES.find((delivery) => delivery === kind) ??
        (kind === 'native queue promotion' ? 'queue' : 'whenIdle')
      const first = fakeSchedule({
        id: 'first',
        delivery,
        ...(kind === 'background' && { whenClosed: 'open' }),
        catchUp: 'runOnce',
        grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from(1).toAmount() },
        paidCapUsd: Usd.from(1).toAmount(),
      })
      const second = fakeSchedule({ ...first, id: 'second', createdAtMs: first.createdAtMs + 1 })
      await store.create(first)
      await store.create(second)
      const now = first.nextFireAtMs!
      const closing = new AbortController()
      const deliver = vi.fn(
        async (
          schedule: ScheduleV2,
          context: { runId: string },
          at: number,
          event?: ScheduleEvent,
        ) => {
          expect(await store.lookupRun(schedule.workspaceKey, context.runId)).toEqual({
            status: 'dispatchStarted',
            retainedLiabilityUsd: schedule.grant.paidCapUsd,
          })
          const fire = {
            ...terminal(schedule, context.runId, at),
            ...(event !== undefined && { event }),
          }
          if (exit === 'returned' || schedule.id === 'second') return fire
          if (exit === 'refused') return { ...fire, outcome: 'refused' as const }
          if (exit === 'cost read failed')
            return {
              ...fire,
              reason: UI_TEXT.scheduleV2.messages.costUnknown,
              cost: {
                ...noScheduleCost(),
                certainty: 'unknown' as const,
                retainedLiabilityUsd: Usd.from(1).toAmount(),
              },
            }
          if (exit === 'host process ending' || exit === 'runtime closed') {
            closing.abort()
            return await new Promise<ScheduleFireRecord>(() => undefined)
          }
          throw new Error(exit)
        },
      )
      const deps = {
        store,
        runs: store,
        queue: { serialize: (key: string, work: () => Promise<void>) => fs.lock(key, work) },
        host: {
          signal: closing.signal,
          now: () => now,
          monotonicNow: () => now,
          holds: () => true,
          lookupRun: (id: string) => store.lookupRun(first.workspaceKey, id),
          deliver,
        },
        time: {
          plan: (schedule: ScheduleV2) => ({ occurrenceMs: schedule.nextFireAtMs!, missed: false }),
        },
        failureSettlement: () => Promise.reject(new Error('host cannot settle')),
        deferEvent: () => Promise.resolve(),
      }
      const scheduler = createScheduler(deps)
      if (kind === 'run-now') {
        const event = {
          source: 'manual' as const,
          eventKey: 'manual-matrix',
          kind: 'manual' as const,
          fields: {},
          observedAt: now,
        }
        await store.admit({
          schedule: second,
          runId: scheduleEventRunId(second.id, event),
          occurrenceMs: now,
          event,
          advancesTime: false,
        })
        await scheduler.request(
          { method: 'schedules/runNow', workspaceKey: first.workspaceKey, id: first.id },
          'manual-matrix',
        )
      } else await scheduler.poll(first.workspaceKey)
      const fires = await store.fires(first.workspaceKey)
      expect(fires).toHaveLength(2)
      expect(await store.pending(first.workspaceKey)).toEqual([])
      expect(scheduler.blockedRuns()).toEqual([])
      const fire = fires.find((fire) => fire.scheduleId === first.id)!
      let expectedOutcome: ScheduleFireRecord['outcome'] = 'uncertain'
      if (exit === 'returned' || exit === 'cost read failed') expectedOutcome = 'ran'
      else if (exit === 'refused') expectedOutcome = 'refused'
      expect(fire.outcome).toBe(expectedOutcome)
      if (fire.outcome === 'uncertain')
        expect(fire).toMatchObject({
          reason: UI_TEXT.scheduleV2.messages.dispatchUncertain,
          cost: { certainty: 'unknown', retainedLiabilityUsd: Usd.from(1).toAmount() },
        })
      const reopened = createScheduleStore(fs)
      const reload = createScheduler({
        ...deps,
        store: reopened,
        runs: reopened,
        host: { ...deps.host, signal: new AbortController().signal },
      })
      await reload.recover(first.workspaceKey)
      if (kind === 'run-now') {
        for (const job of [first, second])
          await reload.request(
            {
              method: 'schedules/runNow',
              workspaceKey: job.workspaceKey,
              id: job.id,
            },
            'manual-matrix',
          )
      } else await reload.poll(first.workspaceKey)
      expect(deliver.mock.calls.filter(([schedule]) => schedule.id === first.id)).toHaveLength(1)
      expect(await reopened.lookupRun(first.workspaceKey, fire.runId)).toMatchObject({
        status: fire.outcome === 'uncertain' ? 'uncertain' : 'settled',
        fire,
      })
      await scheduler.close()
      await reload.close()
    },
  )
})

it('recovers the dispatch-time liability snapshot after the grant changes', async () => {
  const fs = new MemoryScheduleFs()
  const store = createScheduleStore(fs)
  const schedule = fakeSchedule({
    paidCapUsd: Usd.from(1).toAmount(),
    grant: {
      rules: [],
      destinationIds: [],
      paidCapUsd: Usd.from(1).toAmount(),
    },
  })
  await store.create(schedule)
  const intent = {
    schedule,
    runId: `${schedule.id}:liability`,
    occurrenceMs: schedule.nextFireAtMs!,
    advancesTime: false,
  }
  await store.admit(intent)
  await store.advance(intent)
  const [current] = await store.list(schedule.workspaceKey)
  if (current === undefined) throw new Error('missing current grant')
  await store.update({
    ...current,
    paidCapUsd: Usd.from(2).toAmount(),
    grant: { ...current.grant, paidCapUsd: Usd.from(2).toAmount() },
  })
  await store.startDispatch(intent, Usd.from(2).toAmount())
  const [dispatched] = await store.list(schedule.workspaceKey)
  if (dispatched === undefined) throw new Error('missing dispatched grant')
  await store.update({
    ...dispatched,
    paidCapUsd: Usd.from(3).toAmount(),
    grant: { ...dispatched.grant, paidCapUsd: Usd.from(3).toAmount() },
  })
  const reopened = createScheduleStore(fs)
  const deliver = vi.fn(() => Promise.reject(new Error('must not replay')))
  const scheduler = createScheduler({
    store: reopened,
    runs: reopened,
    queue: { serialize: (key, work) => fs.lock(key, work) },
    host: {
      now: () => intent.occurrenceMs,
      monotonicNow: () => intent.occurrenceMs,
      holds: () => true,
      lookupRun: () => Promise.resolve({ status: 'absent' }),
      deliver,
    },
    time: { plan: () => ({ missed: false }) },
    deferEvent: () => Promise.resolve(),
    failureSettlement: () => Promise.reject(new Error('unknown host result')),
  })
  await scheduler.recover(schedule.workspaceKey)
  expect(await reopened.fires(schedule.workspaceKey)).toEqual([
    expect.objectContaining({
      outcome: 'uncertain',
      cost: { usd: '0', certainty: 'unknown', retainedLiabilityUsd: '2' },
    }),
  ])
  expect(deliver).not.toHaveBeenCalled()
  await scheduler.close()
})
