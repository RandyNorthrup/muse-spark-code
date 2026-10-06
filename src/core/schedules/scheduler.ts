// Shared scheduler: hosts supply clocks, ownership and fully settled delivery.
// T computes time occurrences; E filters/debounces and persists delayed events;
// U/D own unattended admission and run-scoped refusal/paid settlement facts.
import { SCHEDULE_POLL_INTERVAL_MS } from '../../shared/constants'
import { UI_TEXT } from '../../shared/l10n/text'
import {
  scheduleEventRunId,
  scheduleEventSchema,
  type ScheduleEvent,
} from '../../shared/scheduleEvents'
import {
  scheduleRequestSchema,
  scheduleTimeRunId,
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
    await deps.store.record(fire)
  }
  const execute = async (intent: ScheduleRunIntent, isMissed: boolean): Promise<void> => {
    const job = await load(intent.schedule.workspaceKey, intent.schedule.id)
    if (job === undefined || !deps.host.holds(job.workspaceKey) || !canRun(job, deps.host.now()))
      return
    // A queued candidate never restores an earlier grant, mode or consent.
    // A changed trigger or target invalidates its old occurrence altogether.
    if (
      JSON.stringify(job.trigger) !== JSON.stringify(intent.schedule.trigger) ||
      job.zone !== intent.schedule.zone ||
      JSON.stringify(job.target) !== JSON.stringify(intent.schedule.target) ||
      job.delivery !== intent.schedule.delivery
    )
      return
    const current = { ...intent, schedule: job }
    if (!(await deps.runs.admit(current))) return
    if (!(await deps.runs.advance(current))) {
      await settle(current, unspent(current, deps.host.now(), 'skipped'))
      return
    }
    if (isMissed && job.catchUp === 'skip') {
      await settle(current, unspent(current, deps.host.now(), 'missed'))
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
      await settle(current, unspent(current, deps.host.now(), 'skipped'))
      return
    }
    const delivery = { ...current, schedule: fresh }
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
      result = await deps.failureSettlement(delivery, error)
    }
    await settle(delivery, result)
  }
  const dispatch = async (entries: readonly { intent: ScheduleRunIntent; missed: boolean }[]) => {
    const groups = new Map<string, { intent: ScheduleRunIntent; missed: boolean }[]>()
    const parallel: Promise<unknown>[] = []
    for (const entry of entries) {
      if (pending.has(entry.intent.runId)) continue
      pending.add(entry.intent.runId)
      if (entry.intent.schedule.parallel) {
        const run = async () => {
          try {
            await execute(entry.intent, entry.missed)
          } finally {
            pending.delete(entry.intent.runId)
          }
        }
        parallel.push(run())
      } else {
        const key = targetKey(entry.intent.schedule)
        const group = groups.get(key) ?? []
        group.push(entry)
        groups.set(key, group)
      }
    }
    const serial = Array.from(groups, async ([key, group]) => {
      try {
        await deps.queue.serialize(key, async () => {
          const ordered = group.toSorted(
            (a, b) => a.intent.schedule.createdAtMs - b.intent.schedule.createdAtMs,
          )
          for (const entry of ordered) await execute(entry.intent, entry.missed)
        })
      } finally {
        for (const entry of group) pending.delete(entry.intent.runId)
      }
    })
    // Always drain independent targets, even if one disk/settlement fails.
    const results = await Promise.allSettled([...serial, ...parallel])
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
      await dispatch(entries)
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
      const abandoned = await deps.runs.abandoned(workspaceKey)
      for (const intent of abandoned) {
        await deps.queue.serialize(targetKey(intent.schedule), async () => {
          const records = await deps.store.fires(workspaceKey)
          const existing = records.find((fire) => fire.runId === intent.runId)
          const isAdmitted = await deps.runs.advance(intent)
          await settle(
            intent,
            existing ??
              (isAdmitted
                ? await deps.failureSettlement(intent, new Error('scheduleOwnerExited'))
                : unspent(intent, deps.host.now(), 'skipped')),
          )
        })
      }
    },
    start(workspaces: () => readonly string[], onError: (error: unknown) => void) {
      let isDisposed = false
      const ready = new Map<string, Promise<void>>()
      const tick = () => {
        if (isDisposed) return
        for (const workspace of workspaces()) {
          if (!deps.host.holds(workspace)) continue
          let initial = ready.get(workspace)
          if (initial === undefined) {
            initial = scheduler.recover(workspace)
            ready.set(workspace, initial)
          }
          void initial
            .then(async () => {
              if (!isDisposed) await scheduler.poll(workspace)
            })
            .catch((error: unknown) => {
              ready.delete(workspace)
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
