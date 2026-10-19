// A failed delivery round is journaled before it travels (PLAN.md D119):
// absent and admitted-not-returned failures reject with the delivery error
// and record nothing; settled recovery resolves with the proven fire; an
// ambiguous or unvalidated recovery settles its failed accounting first and
// then rejects so the poll record hears it.
//
// Real code throughout: the real scheduler over the real file-backed
// schedule store and run journal in a real temp dir (the store serves both
// ports, the way the production engine wires them), holding a real
// schedulable schedule parsed by the real schema. Only the delivery layer
// is scripted — its ledgers and outcomes are the scenario, the way a
// recorded provider answer would be — and the clock is the host port's own
// seam, fixed so run identities stay deterministic.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { createScheduler, type SchedulerDeps } from '../../src/core/schedules/scheduler'
import { createScheduleStore } from '../../src/core/schedules/store'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import { scheduleFailedSettlement } from '../../src/runtime/schedules/engine'
import type { ScheduleRunIntent } from '../../src/core/schedules/store'
import { scheduleEventRunId } from '../../src/shared/scheduleEvents'
import { Usd } from '../../src/shared/usd'
import {
  scheduleFireRecordSchema,
  scheduleV2Schema,
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
  // A real schedulable schedule: the store parses it on every read, so an
  // invalid shape fails here instead of silently standing in.
  return scheduleV2Schema.parse({
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
    parallel: false,
    zone: 'America/Los_Angeles',
    pinned: false,
    version: 2,
    revision: 0,
    workspaceKey,
    paused: false,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    nextFireAtMs: nowMs + 60_000,
    fireCount: 0,
    consecutiveFailures: 0,
    depth: 0,
    allowAgentReschedule: false,
    creator: { kind: 'agent', agentId: 'lead', sessionId: 'planning', orchestratorId: 'orch' },
  })
}

async function setup(state: {
  deliver: () => Promise<unknown>
  ledgers: [ScheduleDeliveryState, ...ScheduleDeliveryState[]]
}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'muse-schedule-failures-'))
  const store = createScheduleStore(createNodeScheduleFs(dir))
  await store.create(job())
  const settlements: unknown[] = []
  const remaining = [...state.ledgers]
  const last = state.ledgers.at(-1)!
  // The journal pre-check and the host recovery read draw successive run
  // states in call order: a fresh fire reads absent before dispatch, then
  // the recovery state the scenario scripts.
  const nextLedger = () => remaining.shift() ?? last
  const deps: SchedulerDeps = {
    store,
    runs: store,
    // Single-flight requests: no concurrent dispatch shares a target, so the
    // inline tail is the whole queue.
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
      return Promise.resolve(scheduleFailedSettlement(intent, error, nowMs))
    },
  }
  const scheduler = createScheduler(deps)
  const fire = () =>
    scheduler.request({ method: 'schedules/runNow', workspaceKey, id: scheduleId }, requestId)
  return {
    scheduler,
    fire,
    fires: () => store.fires(workspaceKey),
    settlements,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

function recoveredFire(certainty: 'exact' | 'unknown'): ScheduleFireRecord {
  const stored = job()
  return scheduleFireRecordSchema.parse({
    runId,
    scheduleId: stored.id,
    workspaceKey,
    occurrenceMs: nowMs,
    observedAtMs: nowMs,
    target: stored.target,
    delivery: stored.delivery,
    outcome: 'ran',
    refusedActions: [],
    cost: { usd: '0', certainty, retainedLiabilityUsd: '0' },
    event: { source: 'manual', eventKey: requestId, kind: 'manual', fields: {}, observedAt: nowMs },
  })
}

/** A settled failed accounting leaves one settlement and one failed fire behind. */
async function expectFailedSettlement(
  settlements: unknown[],
  fires: () => Promise<readonly ScheduleFireRecord[]>,
): Promise<void> {
  expect(settlements).toHaveLength(1)
  const recorded = await fires()
  expect(recorded).toHaveLength(1)
  expect(recorded[0]?.outcome).toBe('failed')
}

describe('schedule delivery failures', () => {
  it('rejects an absent run with the delivery error and records nothing', async () => {
    const deliveryError = new Error('sendDown')
    const { fire, fires, cleanup } = await setup({
      deliver: () => Promise.reject(deliveryError),
      ledgers: [{ status: 'absent' }],
    })
    try {
      await expect(fire()).rejects.toBe(deliveryError)
      expect(await fires()).toEqual([])
    } finally {
      await cleanup()
    }
  })

  it('rejects admitted-not-returned work with the transport error', async () => {
    const deliveryError = new Error('transportDown')
    const { fire, fires, settlements, cleanup } = await setup({
      deliver: () => Promise.reject(deliveryError),
      ledgers: [{ status: 'absent' }, { status: 'admitted' }],
    })
    try {
      await expect(fire()).rejects.toBe(deliveryError)
      expect(await fires()).toEqual([])
      expect(settlements).toEqual([])
    } finally {
      await cleanup()
    }
  })

  it('resolves a proven settlement with the recovered fire', async () => {
    const recovered = recoveredFire('exact')
    const { fire, fires, settlements, cleanup } = await setup({
      deliver: () => Promise.reject(new Error('responseLost')),
      ledgers: [{ status: 'settled', fire: recovered }],
    })
    try {
      await expect(fire()).resolves.toEqual({ kind: 'accepted', id: scheduleId })
      expect(await fires()).toEqual([recovered])
      expect(settlements).toEqual([])
    } finally {
      await cleanup()
    }
  })

  it('settles an ambiguous recovery and still rejects with the delivery error', async () => {
    const deliveryError = new Error('ambiguousSend')
    const recovered = recoveredFire('unknown')
    const { fire, fires, cleanup } = await setup({
      deliver: () => Promise.reject(deliveryError),
      ledgers: [{ status: 'uncertain', fire: recovered }],
    })
    try {
      await expect(fire()).rejects.toBe(deliveryError)
      expect(await fires()).toEqual([recovered])
    } finally {
      await cleanup()
    }
  })

  it('settles a failed accounting and rejects when the recovered fire is foreign', async () => {
    const stored = job()
    const foreign = scheduleFireRecordSchema.parse({
      ...recoveredFire('unknown'),
      scheduleId: 'schedule-other',
      target: stored.target,
    })
    const { fire, fires, settlements, cleanup } = await setup({
      deliver: () => Promise.reject(new Error('sendDown')),
      ledgers: [{ status: 'settled', fire: foreign }],
    })
    try {
      await expect(fire()).rejects.toThrow('scheduleSettlementIdentityMismatch')
      await expectFailedSettlement(settlements, fires)
    } finally {
      await cleanup()
    }
  })

  it('settles a failed accounting when a returned settlement is refused after admission', async () => {
    const { fire, fires, settlements, cleanup } = await setup({
      deliver: () => Promise.resolve({}),
      ledgers: [{ status: 'admitted' }],
    })
    try {
      await expect(fire()).rejects.toThrow()
      await expectFailedSettlement(settlements, fires)
    } finally {
      await cleanup()
    }
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
