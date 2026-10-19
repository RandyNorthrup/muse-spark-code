// A failed delivery round is journaled before it travels (PLAN.md D119):
// absent and admitted-not-returned failures reject with the delivery error
// and record nothing; settled recovery resolves with the proven fire; an
// ambiguous or unvalidated recovery settles its failed accounting first and
// then rejects so the poll record hears it.
import { beforeEach, describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { createScheduler, type SchedulerDeps } from '../../src/core/schedules/scheduler'
import { scheduleFailedSettlement } from '../../src/runtime/schedules/engine'
import type { ScheduleRunIntent } from '../../src/core/schedules/store'
import { scheduleEventRunId } from '../../src/shared/scheduleEvents'
import { Usd } from '../../src/shared/usd'
import {
  scheduleFireRecordSchema,
  type ScheduleDeliveryResult,
  type ScheduleDeliveryState,
  type ScheduleFireRecord,
  type ScheduleV2,
} from '../../src/shared/scheduleV2'

const workspaceKey = 'workspace-1'
const scheduleId = 'schedule-1'
const requestId = 'req-1'
const runId = scheduleEventRunId(scheduleId, { source: 'manual', eventKey: requestId })
const nowMs = 1_700_000_000_000

function job(): ScheduleV2 {
  return {
    id: scheduleId,
    name: 'Check the build',
    action: { kind: 'prompt', prompt: 'Read the build result and report any failures.' },
    trigger: { kind: 'interval', everyMs: 3_600_000, anchorMs: nowMs },
    target: { kind: 'conversation', sessionId: 'build-session', backend: 'modelApi' },
    delivery: 'interrupt',
    whenClosed: 'open',
    catchUp: 'runOnce',
    mode: 'manual',
    grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from(1).toAmount() },
    paidCapUsd: Usd.from(1).toAmount(),
    parallel: true,
    zone: 'America/Los_Angeles',
    pinned: false,
    version: 2,
    revision: 2,
    workspaceKey,
    paused: false,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    nextFireAtMs: nowMs + 60_000,
    fireCount: 2,
    consecutiveFailures: 0,
    depth: 0,
    allowAgentReschedule: false,
    creator: { kind: 'agent', agentId: 'lead', sessionId: 'planning', orchestratorId: 'orch' },
  }
}

function setup(state: {
  deliver: () => Promise<unknown>
  ledgers: [ScheduleDeliveryState, ...ScheduleDeliveryState[]]
}) {
  const recorded: ScheduleFireRecord[] = []
  const settlements: unknown[] = []
  const admitted: ScheduleRunIntent[] = []
  const stored = job()
  const remaining = [...state.ledgers]
  const last = state.ledgers.at(-1)!
  // The journal pre-check and the host recovery read draw successive run
  // states in call order: a fresh fire reads absent before dispatch, then
  // the recovery state the scenario scripts.
  const nextLedger = () => remaining.shift() ?? last
  const deps: SchedulerDeps = {
    store: {
      create: () => Promise.resolve(),
      list: () => Promise.resolve([stored]),
      update: () => Promise.resolve(true),
      remove: () => Promise.resolve(true),
      claim: () => Promise.resolve(true),
      record: (fire) => {
        recorded.push(fire)
        return Promise.resolve()
      },
      fires: () => Promise.resolve(recorded),
    },
    runs: {
      admit: (intent) => {
        admitted.push(intent)
        return Promise.resolve(true)
      },
      // Single owner: this process always wins the dispatch fence, so the
      // delivery-failure paths below run as the dispatch owner.
      startDispatch: () => Promise.resolve(true),
      lookupRun: (_workspaceKey, runId) =>
        Promise.resolve({
          status: admitted.some((intent) => intent.runId === runId)
            ? ('admitted' as const)
            : ('absent' as const),
        }),
      advance: () => Promise.resolve(true),
      pending: () => Promise.resolve([...admitted]),
      abandoned: () => Promise.resolve([]),
      acknowledge: (fire) => {
        admitted.splice(
          admitted.findIndex((intent) => intent.runId === fire.runId),
          1,
        )
        return Promise.resolve()
      },
      acknowledged: () => Promise.resolve(undefined),
      maintain: () => Promise.resolve(),
    },
    queue: { serialize: (_key, work) => work() },
    host: {
      now: () => nowMs,
      monotonicNow: () => 0,
      holds: () => true,
      lookupRun: () => Promise.resolve(nextLedger()),
      deliver: () => state.deliver() as Promise<ScheduleDeliveryResult>,
    },
    time: {
      plan: () => {
        throw new Error('timePlanUnused')
      },
    },
    deferEvent: () => Promise.resolve(),
    failureSettlement: (intent, error) => {
      settlements.push(error)
      return Promise.resolve(
        scheduleFireRecordSchema.parse({
          runId: intent.runId,
          scheduleId: intent.schedule.id,
          workspaceKey: intent.schedule.workspaceKey,
          occurrenceMs: intent.occurrenceMs,
          observedAtMs: nowMs,
          target: intent.schedule.target,
          delivery: intent.schedule.delivery,
          outcome: 'failed',
          reason: 'Delivery failed: Error',
          refusedActions: [],
          cost: { usd: '0', certainty: 'unknown', retainedLiabilityUsd: '0' },
          ...(intent.event !== undefined && { event: intent.event }),
        }),
      )
    },
  }
  const scheduler = createScheduler(deps)
  const fire = () =>
    scheduler.request({ method: 'schedules/runNow', workspaceKey, id: scheduleId }, requestId)
  return { scheduler, fire, recorded, settlements }
}

function recoveredFire(outcome: 'ran', certainty: 'exact' | 'unknown'): ScheduleFireRecord {
  const stored = job()
  return scheduleFireRecordSchema.parse({
    runId,
    scheduleId: stored.id,
    workspaceKey,
    occurrenceMs: nowMs,
    observedAtMs: nowMs,
    target: stored.target,
    delivery: stored.delivery,
    outcome,
    refusedActions: [],
    cost: { usd: '0', certainty, retainedLiabilityUsd: '0' },
    event: { source: 'manual', eventKey: requestId, kind: 'manual', fields: {}, observedAt: nowMs },
  })
}

describe('schedule delivery failures', () => {
  it('rejects an absent run with the delivery error and records nothing', async () => {
    const deliveryError = new Error('sendDown')
    const { fire, recorded } = setup({
      deliver: () => Promise.reject(deliveryError),
      ledgers: [{ status: 'absent' }],
    })
    await expect(fire()).rejects.toBe(deliveryError)
    expect(recorded).toEqual([])
  })

  it('rejects admitted-not-returned work with the transport error', async () => {
    const deliveryError = new Error('transportDown')
    const { fire, recorded, settlements } = setup({
      deliver: () => Promise.reject(deliveryError),
      ledgers: [{ status: 'absent' }, { status: 'admitted' }],
    })
    await expect(fire()).rejects.toBe(deliveryError)
    expect(recorded).toEqual([])
    expect(settlements).toEqual([])
  })

  it('resolves a proven settlement with the recovered fire', async () => {
    const recovered = recoveredFire('ran', 'exact')
    const { fire, recorded, settlements } = setup({
      deliver: () => Promise.reject(new Error('responseLost')),
      ledgers: [{ status: 'settled', fire: recovered }],
    })
    await expect(fire()).resolves.toEqual({ kind: 'accepted', id: scheduleId })
    expect(recorded).toEqual([recovered])
    expect(settlements).toEqual([])
  })

  it('settles an ambiguous recovery and still rejects with the delivery error', async () => {
    const deliveryError = new Error('ambiguousSend')
    const recovered = recoveredFire('ran', 'unknown')
    const { fire, recorded } = setup({
      deliver: () => Promise.reject(deliveryError),
      ledgers: [{ status: 'uncertain', fire: recovered }],
    })
    await expect(fire()).rejects.toBe(deliveryError)
    expect(recorded).toEqual([recovered])
  })

  it('settles a failed accounting and rejects when the recovered fire is foreign', async () => {
    const stored = job()
    const foreign = scheduleFireRecordSchema.parse({
      ...recoveredFire('ran', 'unknown'),
      scheduleId: 'schedule-other',
      target: stored.target,
    })
    const { fire, recorded, settlements } = setup({
      deliver: () => Promise.reject(new Error('sendDown')),
      ledgers: [{ status: 'settled', fire: foreign }],
    })
    await expect(fire()).rejects.toThrow('scheduleSettlementIdentityMismatch')
    expect(settlements).toHaveLength(1)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.outcome).toBe('failed')
  })

  it('settles a failed accounting when a returned settlement is refused after admission', async () => {
    const { fire, recorded, settlements } = setup({
      deliver: () => Promise.resolve({}),
      ledgers: [{ status: 'admitted' }],
    })
    await expect(fire()).rejects.toThrow()
    expect(settlements).toHaveLength(1)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.outcome).toBe('failed')
  })
})

describe('failed schedule settlement', () => {
  beforeEach(() => {
    setUiText(EN, BASE_LOCALE)
  })
  const intent: ScheduleRunIntent = {
    schedule: job(),
    runId,
    occurrenceMs: nowMs,
    advancesTime: false,
  }

  it('names the delivery failure kind so the history shows why the fire failed', () => {
    const record = scheduleFailedSettlement(intent, new Error('transportDown'), nowMs)
    expect(record.outcome).toBe('failed')
    expect(record.runId).toBe(runId)
    expect(record.reason).toContain('Delivery failed')
    expect(record.reason).toContain('Error')
    expect(record.cost.certainty).toBe('unknown')
  })

  it('reads a foreign throwable as an unknown failure, never its text', () => {
    const record = scheduleFailedSettlement(intent, 'boom', nowMs)
    expect(record.reason).toContain('Delivery failed')
  })
})
