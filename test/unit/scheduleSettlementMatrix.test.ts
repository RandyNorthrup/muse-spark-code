import { describe, expect, it, vi } from 'vitest'
import { scheduleEventRunId, type ScheduleEvent } from '../../src/shared/scheduleEvents'
import { Usd } from '../../src/shared/usd'
import { ScheduleDelivery } from '../../src/core/schedules/delivery'
import { IdleScheduleSession } from './helpers/schedules/session'
import { createScheduler } from '../../src/core/schedules/scheduler'
import { scheduleRunContextOf } from '../../src/core/schedules/fireRecord'
import { createScheduleStore } from '../../src/core/schedules/store'
import { SCHEDULE_DELIVERIES, UI_TEXT } from '../../src/shared/constants'
import {
  noScheduleCost,
  type ScheduleFireRecord,
  type ScheduleV2,
} from '../../src/shared/scheduleV2'
import { MemoryScheduleFs } from './helpers/schedules/storage'
import { fakeSchedule } from './helpers/schedules/fixtures'

// The real delivery adapter distinguishes every enum, background opening,
// Run now and native queue admission. Host composition owns promotion receipts.
const kinds = [...SCHEDULE_DELIVERIES, 'background', 'run-now', 'native queue admission'] as const
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
    'journals $exit for $kind, preserves/delivers the next fire and never replays',
    async ({ kind, exit }) => {
      const fs = new MemoryScheduleFs()
      const store = createScheduleStore(fs)
      const delivery =
        SCHEDULE_DELIVERIES.find((delivery) => delivery === kind) ??
        (kind === 'native queue admission' ? 'queue' : 'whenIdle')
      const first = fakeSchedule({
        id: 'first',
        target: { kind: 'conversation', backend: 'museCode', sessionId: 'session-1' },
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
          const session = new IdleScheduleSession('museCode')
          session.running =
            delivery === 'steer' || delivery === 'interrupt' || kind === 'native queue admission'
          const lease = { session, release: () => Promise.resolve() }
          const open = vi.fn(() => Promise.resolve(lease))
          const fresh = vi.fn(() => Promise.resolve(lease))
          const pipeline = new ScheduleDelivery({
            now: () => now,
            monotonicNow: () => now,
            holds: () => true,
            targets: {
              find: () => Promise.resolve(kind === 'background' ? undefined : lease),
              open,
              fresh,
            },
            prompt: () => 'matrix prompt',
            runs: {
              run: async (_session, _job, _context, dispatch) => {
                const fire = {
                  ...terminal(schedule, context.runId, at),
                  ...(event !== undefined && { event }),
                }
                if (exit === 'refused' && schedule.id === 'first') {
                  expect(session.calls).toEqual([])
                  return { ...fire, outcome: 'refused' }
                }
                await dispatch()
                let expected: string[]
                switch (delivery) {
                  case 'interrupt': {
                    expected = ['cancel', 'send']
                    break
                  }
                  case 'steer': {
                    expected = ['steer']
                    break
                  }
                  case 'queue':
                  case 'whenIdle': {
                    expected = ['queue']
                    break
                  }
                  case 'newConversation': {
                    expected = ['send']
                    break
                  }
                }
                expect(session.calls.map((call) => call.kind)).toEqual(expected)
                if (kind === 'native queue admission') expect(session.queued.size).toBe(1)
                if (exit === 'returned' || schedule.id === 'second') return fire
                if (exit === 'cost read failed')
                  return {
                    ...fire,
                    reason: UI_TEXT.scheduleV2.messages.costUnknown,
                    cost: {
                      ...noScheduleCost(),
                      certainty: 'unknown',
                      retainedLiabilityUsd: Usd.from(1).toAmount(),
                    },
                  }
                if (exit === 'runtime closed' || exit === 'host process ending') {
                  closing.abort()
                  return await new Promise<ScheduleFireRecord>(() => undefined)
                }
                if (['aborted', 'window closed', 'session closed'].includes(exit)) {
                  closing.abort()
                  if (exit !== 'aborted') session.open = false
                  await new Promise<void>((resolve) => setImmediate(resolve))
                  // R4: the run cannot confirm a queue withdrawal (it never
                  // withdrew), so like a started or never-submitted turn it
                  // reports nothing and the core keeps the outcome unknown.
                  // A confirmed withdrawal is covered in
                  // scheduleKnownCloseResult (engine) and
                  // scheduleDeliveryBinding (withdrawal sentence).
                  throw new Error(`unconfirmed ${exit}`)
                }
                throw new Error(exit)
              },
            },
          })
          const result = await pipeline.deliver(
            schedule,
            { ...scheduleRunContextOf(schedule, context.runId) },
            at,
            event,
          )
          if (delivery === 'newConversation') expect(fresh).toHaveBeenCalledOnce()
          else if (kind === 'background') expect(open).toHaveBeenCalledOnce()
          return result
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
      expect(fires).toHaveLength(closing.signal.aborted ? 1 : 2)
      if (closing.signal.aborted) {
        expect(await store.pending(first.workspaceKey)).toHaveLength(1)
        expect(deliver.mock.calls.filter(([schedule]) => schedule.id === second.id)).toHaveLength(0)
      } else {
        expect(await store.pending(first.workspaceKey)).toEqual([])
        expect(fires.find((fire) => fire.scheduleId === second.id)?.outcome).toBe('ran')
      }
      expect(scheduler.blockedRuns()).toEqual([])
      const fire = fires.find((fire) => fire.scheduleId === first.id)!
      let expectedOutcome: ScheduleFireRecord['outcome'] = 'uncertain'
      switch (exit) {
        case 'returned':
        case 'cost read failed': {
          expectedOutcome = 'ran'
          break
        }
        case 'refused': {
          expectedOutcome = 'refused'
          break
        }
        case 'aborted':
        case 'window closed':
        case 'session closed': {
          expectedOutcome = 'uncertain'
          break
        }
      }
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
      expect(deliver.mock.calls.filter(([schedule]) => schedule.id === second.id)).toHaveLength(1)
      const final = await reopened.fires(first.workspaceKey)
      expect(final).toHaveLength(2)
      expect(final.find((fire) => fire.scheduleId === second.id)?.outcome).toBe('ran')
      expect(await reopened.pending(first.workspaceKey)).toEqual([])
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
