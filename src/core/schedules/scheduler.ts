// Shared scheduler: hosts supply clocks, ownership and fully settled delivery.
// T computes time occurrences; E filters/debounces and persists delayed events;
// U/D own unattended admission and run-scoped refusal/paid settlement facts.
import { SCHEDULE_POLL_INTERVAL_MS, SCHEDULE_RECONCILE_MAX_RUNS } from '../../shared/constants'
import { UI_TEXT } from '../../shared/l10n/text'
import {
  scheduleEventRunId,
  scheduleEventSchema,
  type ScheduleEvent,
} from '../../shared/scheduleEvents'
import {
  scheduleRequestSchema,
  scheduleTimeRunId,
  scheduleDeliveryStateSchema,
  type ScheduleHostPort,
  type ScheduleStoreV2,
  type ScheduleV2,
  type ScheduleFireRecord,
} from '../../shared/scheduleV2'
import { scheduleRunContextOf, validateScheduleSettlement } from './fireRecord'
import type { ScheduleQueuePort, ScheduleRunIntent, ScheduleRunJournalPort } from './store'

export interface ScheduleClockReading {
  readonly nowMs: number
  readonly monotonicMs: number
  readonly wallDeltaMs: number
  readonly monotonicDeltaMs: number
  readonly hasJumped: boolean
  readonly isStartup: boolean
}
export interface ScheduleTimePlan {
  readonly occurrenceMs?: number
  readonly nextFireAtMs?: number
  readonly missed: boolean
}
export interface ScheduleTimePort {
  /** At most one catch-up; a missed plan's next occurrence is after now. */
  plan(schedule: ScheduleV2, clock: ScheduleClockReading): ScheduleTimePlan
}
export interface SchedulerDeps {
  readonly store: ScheduleStoreV2
  readonly runs: ScheduleRunJournalPort
  readonly queue: ScheduleQueuePort
  readonly host: ScheduleHostPort
  readonly time: ScheduleTimePort
  /** E persists a manual event composed with time; T computes its due instant. */
  readonly deferEvent: (schedule: ScheduleV2, event: ScheduleEvent) => Promise<void>
  /** D/U settle thrown delivery errors and abandoned claims, including their
   * retained liability. S never invents an exact zero-cost failed dispatch. */
  readonly failureSettlement: (
    intent: ScheduleRunIntent,
    error: unknown,
  ) => Promise<ScheduleFireRecord>
}

function targetKey(schedule: ScheduleV2): string {
  return `${schedule.workspaceKey}:${JSON.stringify(schedule.target)}`
}
function canRun(schedule: ScheduleV2, now: number): boolean {
  return (
    !schedule.paused &&
    (schedule.end?.atMs === undefined || now < schedule.end.atMs) &&
    (schedule.end?.afterRuns === undefined || schedule.fireCount < schedule.end.afterRuns)
  )
}
function unspent(
  intent: ScheduleRunIntent,
  now: number,
  outcome: 'missed' | 'skipped',
): ScheduleFireRecord {
  return {
    runId: intent.runId,
    scheduleId: intent.schedule.id,
    workspaceKey: intent.schedule.workspaceKey,
    occurrenceMs: intent.occurrenceMs,
    observedAtMs: now,
    target: intent.schedule.target,
    delivery: intent.schedule.delivery,
    outcome,
    refusedActions: [],
    cost: { usd: 0, certainty: 'exact', retainedLiabilityUsd: 0 },
    ...(intent.event !== undefined && { event: intent.event }),
  }
}

export function createScheduler(deps: SchedulerDeps) {
  const readings = new Map<string, ScheduleClockReading>()
  const pending = new Set<string>()
  const knownSettlements = new Map<string, ScheduleFireRecord>()
  const clock = (workspaceKey: string): ScheduleClockReading => {
    const nowMs = deps.host.now()
    const monotonicMs = deps.host.monotonicNow()
    if (
      !Number.isSafeInteger(nowMs) ||
      nowMs < 0 ||
      !Number.isFinite(monotonicMs) ||
      monotonicMs < 0
    )
      throw new Error('scheduleClockInvalid')
    const previous = readings.get(workspaceKey)
    const wallDeltaMs = previous === undefined ? 0 : nowMs - previous.nowMs
    const monotonicDeltaMs = previous === undefined ? 0 : monotonicMs - previous.monotonicMs
    const reading = {
      nowMs,
      monotonicMs,
      wallDeltaMs,
      monotonicDeltaMs,
      hasJumped: Math.abs(wallDeltaMs - monotonicDeltaMs) > 1 || monotonicDeltaMs < 0,
      isStartup: previous === undefined,
    }
    readings.set(workspaceKey, reading)
    return reading
  }
  const load = async (workspaceKey: string, id: string) => {
    const jobs = await deps.store.list(workspaceKey)
    return jobs.find((job) => job.id === id)
  }
  const settle = async (intent: ScheduleRunIntent, input: unknown) => {
    const fire = validateScheduleSettlement(
      intent.schedule,
      intent.runId,
      intent.occurrenceMs,
      input,
      intent.event,
    )
    knownSettlements.set(intent.runId, fire)
    await deps.runs.acknowledge(fire)
    await deps.store.record(fire)
    knownSettlements.delete(intent.runId)
  }
  const execute = async (intent: ScheduleRunIntent): Promise<void> => {
    const known =
      knownSettlements.get(intent.runId) ??
      (await deps.runs.acknowledged(intent.schedule.workspaceKey, intent.runId))
    if (known !== undefined) {
      await settle(intent, known)
      return
    }
    const ledger = scheduleDeliveryStateSchema.parse(await deps.host.lookupRun(intent.runId))
    if (ledger.status === 'settled' || ledger.status === 'uncertain') {
      await deps.runs.advance(intent)
      await settle(intent, ledger.fire)
      return
    }
    if (ledger.status === 'admitted') return
    const job = await load(intent.schedule.workspaceKey, intent.schedule.id)
    const isAdmitted = await deps.runs.advance(intent)
    if (!isAdmitted) {
      await settle(intent, unspent(intent, deps.host.now(), 'skipped'))
      return
    }
    // A queued candidate never restores an earlier grant, mode or consent.
    // A changed trigger or target invalidates its old occurrence altogether.
    if (
      job === undefined ||
      job.paused ||
      !deps.host.holds(job.workspaceKey) ||
      (job.end?.atMs !== undefined && deps.host.now() >= job.end.atMs) ||
      JSON.stringify(job.trigger) !== JSON.stringify(intent.schedule.trigger) ||
      job.zone !== intent.schedule.zone ||
      JSON.stringify(job.target) !== JSON.stringify(intent.schedule.target) ||
      job.delivery !== intent.schedule.delivery
    ) {
      await settle(intent, unspent(intent, deps.host.now(), 'skipped'))
      return
    }
    if (intent.missed === true && job.catchUp === 'skip') {
      await settle(intent, unspent(intent, deps.host.now(), 'missed'))
      return
    }
    const fresh = await load(job.workspaceKey, job.id)
    if (
      fresh === undefined ||
      fresh.paused ||
      !deps.host.holds(job.workspaceKey) ||
      (fresh.end?.atMs !== undefined && deps.host.now() >= fresh.end.atMs) ||
      JSON.stringify(fresh.trigger) !== JSON.stringify(job.trigger) ||
      fresh.zone !== job.zone ||
      JSON.stringify(fresh.target) !== JSON.stringify(job.target) ||
      fresh.delivery !== job.delivery
    ) {
      await settle(intent, unspent(intent, deps.host.now(), 'skipped'))
      return
    }
    const delivery = { ...intent, schedule: fresh }
    let result: unknown
    try {
      result = await deps.host.deliver(
        fresh,
        scheduleRunContextOf(fresh, intent.runId),
        intent.occurrenceMs,
        intent.event,
      )
      validateScheduleSettlement(
        delivery.schedule,
        delivery.runId,
        delivery.occurrenceMs,
        result,
        delivery.event,
      )
    } catch (error: unknown) {
      // A bad settlement is a contract failure: its accounting is not discarded
      // into a free success. The delivery owner provides conservative facts.
      const after = scheduleDeliveryStateSchema.parse(await deps.host.lookupRun(intent.runId))
      // Absence is a proof of no admission/send: leave the retained intent for
      // the next poll instead of burning this occurrence or guessing a bill.
      if (after.status === 'absent') throw error
      if (after.status === 'settled' || after.status === 'uncertain') {
        try {
          result = validateScheduleSettlement(
            delivery.schedule,
            delivery.runId,
            delivery.occurrenceMs,
            after.fire,
            delivery.event,
          )
        } catch (error_: unknown) {
          result = await deps.failureSettlement(delivery, error_)
        }
      } else result = await deps.failureSettlement(delivery, error)
    }
    await settle(intent, result)
  }
  const dispatch = async (entries: readonly { intent: ScheduleRunIntent; missed: boolean }[]) => {
    const workspaces = new Set<string>()
    for (const entry of entries) {
      workspaces.add(entry.intent.schedule.workspaceKey)
      await deps.runs.admit({ ...entry.intent, missed: entry.missed })
    }
    await drain([...workspaces])
  }
  const drain = async (workspaces: readonly string[]) => {
    const queues = await Promise.all(
      workspaces.map(async (workspace) => await deps.runs.pending(workspace)),
    )
    const outstanding = queues.flat()
    for (const [runId, fire] of knownSettlements) {
      if (
        workspaces.includes(fire.workspaceKey) &&
        outstanding.every((intent) => intent.runId !== runId)
      )
        knownSettlements.delete(runId)
    }
    const candidates = outstanding
      .filter((intent) => !pending.has(intent.runId))
      .slice(0, SCHEDULE_RECONCILE_MAX_RUNS)
    const groups = new Map<string, ScheduleRunIntent[]>()
    for (const intent of candidates) {
      if (pending.has(intent.runId)) continue
      pending.add(intent.runId)
      const key = intent.schedule.parallel ? `run:${intent.runId}` : targetKey(intent.schedule)
      const group = groups.get(key) ?? []
      group.push(intent)
      groups.set(key, group)
    }
    const work = Array.from(groups, async ([key, group]) => {
      try {
        await deps.queue.serialize(key, async () => {
          // Pop from the shared queue, not the caller's original singleton or
          // batch. Entries from other sources/windows participate in ordering.
          const first = group[0]
          if (first === undefined) return
          for (const _entry of group) {
            const queue = await deps.runs.pending(first.schedule.workspaceKey)
            const intent = queue.find(
              (intent) =>
                (intent.schedule.parallel ? `run:${intent.runId}` : targetKey(intent.schedule)) ===
                key,
            )
            if (intent === undefined) break
            await execute(intent)
            // An admitted but unfinished target entry keeps the head of this
            // serial queue. Do not let the next batch overtake its settlement.
            const retained = await deps.runs.pending(intent.schedule.workspaceKey)
            if (retained.some((entry) => entry.runId === intent.runId)) break
          }
        })
      } finally {
        for (const intent of group) pending.delete(intent.runId)
      }
    })
    // Always drain independent targets, even if one disk/settlement fails.
    const results = await Promise.allSettled(work)
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }
  const manual = async (
    workspaceKey: string,
    id: string,
    requestId: string,
    isOnlyManual: boolean,
  ) => {
    const job = await load(workspaceKey, id)
    if (job === undefined || !deps.host.holds(workspaceKey) || !canRun(job, deps.host.now()))
      return { kind: 'refused' as const, reason: UI_TEXT.scheduleV2.labels.paused }
    const trigger = job.trigger.kind === 'afterEvent' ? job.trigger.event : job.trigger
    if (
      isOnlyManual &&
      (trigger.kind !== 'event' || trigger.event !== 'manual' || trigger.conditions.length > 0)
    )
      return { kind: 'refused' as const, reason: UI_TEXT.scheduleV2.labels.unavailable }
    const event = scheduleEventSchema.parse({
      source: isOnlyManual && trigger.kind === 'event' ? trigger.source : 'manual',
      eventKey: requestId,
      kind: 'manual',
      fields: {},
      observedAt: deps.host.now(),
    })
    if (isOnlyManual && job.trigger.kind === 'afterEvent') {
      await deps.deferEvent(job, event)
      return { kind: 'accepted' as const, id }
    }
    const intent = {
      schedule: job,
      runId: scheduleEventRunId(job.id, event),
      occurrenceMs: event.observedAt,
      event,
      advancesTime: false,
    }
    await dispatch([{ intent, missed: false }])
    return { kind: 'accepted' as const, id }
  }
  const scheduler = {
    async poll(workspaceKey: string): Promise<void> {
      if (!deps.host.holds(workspaceKey)) return
      const reading = clock(workspaceKey)
      await deps.runs.maintain(workspaceKey, reading.nowMs)
      const jobs = await deps.store.list(workspaceKey)
      const entries = []
      for (const job of jobs) {
        if (
          !canRun(job, reading.nowMs) ||
          job.trigger.kind === 'event' ||
          job.trigger.kind === 'afterEvent'
        )
          continue
        const plan = deps.time.plan(job, reading)
        if (plan.occurrenceMs === undefined) continue
        const runId = scheduleTimeRunId(job.id, plan.occurrenceMs)
        if (
          (job.trigger.kind !== 'interval' && plan.occurrenceMs > reading.nowMs) ||
          (job.end?.atMs !== undefined && plan.occurrenceMs >= job.end.atMs)
        )
          throw new Error('scheduleTimePlanInvalid')
        if (
          plan.nextFireAtMs !== undefined &&
          (!Number.isSafeInteger(plan.nextFireAtMs) ||
            plan.nextFireAtMs <= plan.occurrenceMs ||
            (job.trigger.kind !== 'interval' && plan.missed && plan.nextFireAtMs <= reading.nowMs))
        )
          throw new Error('scheduleCatchUpPlanInvalid')
        entries.push({
          intent: {
            schedule: job,
            runId,
            occurrenceMs: plan.occurrenceMs,
            advancesTime: true,
            ...(plan.nextFireAtMs !== undefined && { nextFireAtMs: plan.nextFireAtMs }),
          },
          missed: plan.missed,
        })
      }
      for (const entry of entries) await deps.runs.admit({ ...entry.intent, missed: entry.missed })
      await drain([workspaceKey])
    },
    async fireEvent(
      workspaceKey: string,
      id: string,
      input: unknown,
      occurrenceMs: number,
    ): Promise<void> {
      const event = scheduleEventSchema.parse(input)
      const job = await load(workspaceKey, id)
      if (job === undefined || !canRun(job, deps.host.now()) || !deps.host.holds(workspaceKey))
        return
      const trigger = job.trigger.kind === 'afterEvent' ? job.trigger.event : job.trigger
      if (
        trigger.kind !== 'event' ||
        trigger.source !== event.source ||
        trigger.event !== event.kind ||
        trigger.conditions.some((condition) => event.fields[condition.field] !== condition.equals)
      )
        return
      // E/T call only after a composed event's time is due; they retain it until
      // then. Event identities remain independent of observation/clock time.
      scheduleTimeRunId(job.id, occurrenceMs)
      if (occurrenceMs > deps.host.now()) throw new Error('scheduleEventNotDue')
      await dispatch([
        {
          intent: {
            schedule: job,
            runId: scheduleEventRunId(job.id, event),
            occurrenceMs,
            event,
            advancesTime: false,
          },
          missed: occurrenceMs < deps.host.now() - SCHEDULE_POLL_INTERVAL_MS,
        },
      ])
    },
    async request(input: unknown, requestId: string) {
      const request = scheduleRequestSchema.parse(input)
      if (request.method !== 'schedules/runNow' && request.method !== 'schedules/fire')
        throw new Error('scheduleRequestNotOwnedByScheduler')
      return await manual(
        request.workspaceKey,
        request.id,
        requestId,
        request.method === 'schedules/fire',
      )
    },
    async recover(workspaceKey: string): Promise<void> {
      if (!deps.host.holds(workspaceKey)) return
      await drain([workspaceKey])
    },
    start(workspaces: () => readonly string[], onError: (error: unknown) => void) {
      let isDisposed = false
      const tick = () => {
        if (isDisposed) return
        for (const workspace of workspaces()) {
          if (!deps.host.holds(workspace)) continue
          void scheduler
            .recover(workspace)
            .then(async () => {
              if (!isDisposed) await scheduler.poll(workspace)
            })
            .catch((error: unknown) => {
              onError(error)
            })
        }
      }
      const timer = setInterval(tick, SCHEDULE_POLL_INTERVAL_MS)
      tick()
      return {
        dispose() {
          isDisposed = true
          clearInterval(timer)
        },
      }
    },
  }
  return scheduler
}
