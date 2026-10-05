import { DAYS_PER_WEEK, TEAM_SCHED_HISTORY_MAX } from '../../shared/constants'
import {
  teamTrafficMetricsSchema,
  type TeamAttempt,
  type TeamSchedulerEvent,
  type TeamTrafficMetrics,
} from '../../shared/team'

/** Final ledger rows, including every attempt and review charged to a change.
 * Ledger adapters deduplicate append-only updates by task/attempt before use.
 * Entry/agent filters attribute a multi-author task to every matching participant;
 * only that participant's usage is summed, never another entry's usage.
 */
export interface TrafficLedgerTask {
  id: string
  roleId: string
  createdAt: number
  writing: boolean
  mergedAt?: number
  attempts: readonly TeamAttempt[]
  /** Review charges stay separate when their reported/estimated lane differs.
   * The adapter deduplicates them and attributes each to its owning attempt.
   */
  reviews?: readonly { attempt: number; usage: TeamAttempt['usage'] }[]
}

/** Piecewise-constant slot observations from the scheduler's durable events.
 * `slots` is the capacity at that time, including idle slots. A change closes
 * the preceding interval. Groups must be disjoint within each selected scope.
 */
export interface TrafficSlotSample {
  at: number
  groupId: string
  busy: number
  slots: number
  roleId?: string
  entryId?: string
  agentProfileId?: string
}

export interface TrafficMetricSource {
  tasks: readonly TrafficLedgerTask[]
  events: readonly (TeamSchedulerEvent | TrafficAccountingEvent)[]
  slots: readonly TrafficSlotSample[]
}

/** Review and landing accounting observations, emitted by the ledger adapter. */
interface TrafficAccountingEvent {
  kind: 'reviewRound' | 'mergeConflict' | 'finished'
  taskId: string
  attempt: number
  at: number
  round?: number
}

type MetricScope = Pick<TeamTrafficMetrics, 'period' | 'roleId' | 'entryId' | 'agentProfileId'>
const WAIT_P90 = 0.9

function periodStart(period: MetricScope['period'], now: number): number {
  if (period === 'allTime') return 0
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  if (period === 'week') {
    // Calendar week begins Monday. Calendar arithmetic survives DST changes.
    day.setDate(day.getDate() - ((day.getDay() + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK))
  }
  return day.getTime()
}

function median(samples: readonly number[]): number | null {
  if (samples.length === 0) return null
  const sorted = samples.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? null)
}

function slotTime(samples: readonly TrafficSlotSample[], start: number, now: number) {
  let busySlotMs = 0
  let availableSlotMs = 0
  const groups = new Map<string, TrafficSlotSample[]>()
  const addSample = (sample: TrafficSlotSample) => {
    if (sample.at > now) return
    const group = groups.get(sample.groupId) ?? []
    group.push(sample)
    groups.set(sample.groupId, group)
  }
  for (const sample of samples) addSample(sample)
  for (const rows of groups.values()) {
    const sorted = rows.toSorted((a, b) => a.at - b.at)
    for (const [index, row] of sorted.entries()) {
      if (row.busy < 0 || row.slots < row.busy || !Number.isFinite(row.slots)) {
        throw new Error('Invalid scheduler slot observation')
      }
      const duration = Math.max(0, (sorted[index + 1]?.at ?? now) - Math.max(row.at, start))
      busySlotMs += duration * row.busy
      availableSlotMs += duration * row.slots
    }
  }
  return { busySlotMs, availableSlotMs }
}

/** Local aggregation only: reads immutable ledger/event observations, starts no work. */
export function trafficMetrics(
  source: TrafficMetricSource,
  scope: MetricScope,
  now: number,
): TeamTrafficMetrics & { taskCount: number } {
  const start = periodStart(scope.period, now)
  const isMatchingAttempt = (attempt: TeamAttempt) =>
    (scope.entryId === undefined || attempt.entryId === scope.entryId) &&
    (scope.agentProfileId === undefined || attempt.agentProfileId === scope.agentProfileId)
  const tasks = source.tasks.filter(
    (task) =>
      task.createdAt <= now &&
      (scope.roleId === undefined || task.roleId === scope.roleId) &&
      ((scope.entryId === undefined && scope.agentProfileId === undefined) ||
        task.attempts.some((attempt) => isMatchingAttempt(attempt))),
  )
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const isMatchingEvent = (event: TrafficMetricSource['events'][number]) => {
    if (scope.entryId === undefined && scope.agentProfileId === undefined) return true
    const attempt = byId.get(event.taskId)?.attempts.find((row) => row.number === event.attempt)
    return attempt !== undefined && isMatchingAttempt(attempt)
  }
  const events = source.events
    .filter((event) => event.at <= now && byId.has(event.taskId) && isMatchingEvent(event))
    .toSorted((a, b) => a.at - b.at)
  const isInPeriod = (at: number) => at >= start && at <= now
  const periodEvents = events.filter((event) => isInPeriod(event.at))
  const waits: number[] = []
  const ready = new Map<string, number>()
  const states = new Map<string, 'ready' | 'blocked'>()
  const queueDepth: TeamTrafficMetrics['queueDepth'] = []
  const sampleQueue = (at: number) => {
    let readyCount = 0
    let blockedCount = 0
    for (const state of states.values()) {
      if (state === 'ready') readyCount += 1
      else blockedCount += 1
    }
    queueDepth.push({
      at,
      ready: readyCount,
      blocked: blockedCount,
    })
  }
  const applyEvent = (event: TrafficMetricSource['events'][number]) => {
    const key = `${event.taskId}:${String(event.attempt)}`
    switch (event.kind) {
      case 'ready': {
        if (!ready.has(key)) ready.set(key, event.at)
        states.set(event.taskId, 'ready')
        break
      }
      case 'blocked': {
        states.set(event.taskId, 'blocked')
        ready.delete(key)
        break
      }
      case 'started': {
        const readyAt = ready.get(key)
        const attempt = byId.get(event.taskId)?.attempts.find((row) => row.number === event.attempt)
        if (
          attempt &&
          readyAt !== undefined &&
          isInPeriod(event.at) &&
          isMatchingAttempt(attempt)
        ) {
          waits.push(event.at - readyAt)
        }
        ready.delete(key)
        states.delete(event.taskId)
        break
      }
      case 'landed':
      case 'candidateReturned':
      case 'finished': {
        states.delete(event.taskId)
        break
      }
      default: {
        break
      }
    }
  }
  // Seed the period with earlier states; report depths at each state transition.
  for (const event of events) {
    if (event.at >= start && queueDepth.length === 0) sampleQueue(start)
    applyEvent(event)
    if (
      isInPeriod(event.at) &&
      ['ready', 'started', 'blocked', 'landed', 'candidateReturned', 'finished'].includes(
        event.kind,
      )
    ) {
      sampleQueue(event.at)
    }
  }
  if (queueDepth.length === 0) sampleQueue(start)
  const merged = tasks.filter((task) => task.mergedAt !== undefined && isInPeriod(task.mergedAt))
  const costs = { reportedCostUsd: 0, estimatedCostUsd: 0, reportedTokens: 0, estimatedTokens: 0 }
  for (const task of merged) {
    const charges = task.attempts
      .filter((attempt) => isMatchingAttempt(attempt))
      .map((attempt) => attempt.usage)
    const reviews = task.reviews ?? []
    for (const review of reviews) {
      const owner = task.attempts.find((attempt) => attempt.number === review.attempt)
      if (!owner) throw new Error('Review charge has no owning attempt')
      if (isMatchingAttempt(owner)) charges.push(review.usage)
    }
    for (const usage of charges) {
      // Cached input is a subset of input; reasoning is a subset of output.
      const tokens = usage.inputTokens + usage.outputTokens
      if (usage.accuracy === 'reported') {
        costs.reportedCostUsd += usage.costUsd
        costs.reportedTokens += tokens
      } else {
        costs.estimatedCostUsd += usage.costUsd
        costs.estimatedTokens += tokens
      }
    }
  }
  const active = tasks.filter((task) => isInPeriod(task.createdAt))
  const slots = source.slots.filter(
    (row) =>
      (scope.roleId === undefined || row.roleId === scope.roleId) &&
      (scope.entryId === undefined || row.entryId === scope.entryId) &&
      (scope.agentProfileId === undefined || row.agentProfileId === scope.agentProfileId),
  )
  const sortedWaits = waits.toSorted((a, b) => a - b)
  const metrics = teamTrafficMetricsSchema.parse({
    ...scope,
    ...slotTime(slots, start, now),
    queueDepth: queueDepth.slice(-TEAM_SCHED_HISTORY_MAX),
    waitMedianMs: median(waits),
    waitP90Ms: sortedWaits[Math.ceil(sortedWaits.length * WAIT_P90) - 1] ?? null,
    writingTasks: active.filter((task) => task.writing).length,
    predictedConflicts: periodEvents.filter((event) => event.kind === 'predictedConflict').length,
    landings: merged.length,
    mergeConflicts: periodEvents.filter((event) => event.kind === 'mergeConflict').length,
    reworkRounds: periodEvents.filter(
      (event) => event.kind === 'reviewRound' && (event.round ?? 1) > 1,
    ).length,
    reassignments: periodEvents.filter((event) => event.kind === 'reassigned').length,
    candidatesReturned: periodEvents.filter((event) => event.kind === 'candidateReturned').length,
    mergedChanges: merged.length,
    ...costs,
    timeToMergeMedianMs: median(merged.map((task) => (task.mergedAt ?? now) - task.createdAt)),
  })
  return { ...metrics, taskCount: active.length }
}
