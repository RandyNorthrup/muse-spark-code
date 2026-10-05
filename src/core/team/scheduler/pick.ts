import {
  TEAM_AGING_MS,
  TEAM_PRIORITY_WEIGHTS,
  TEAM_STARVATION_MS,
  TEAM_START_STAGGER_MS,
} from '../../../shared/constants'
import { type TeamBoardTask } from '../../../shared/team'
import { criticalPaths } from './criticalPath'

type Priority = TeamBoardTask['priority']
const priorities: readonly Priority[] = ['low', 'normal', 'high', 'urgent']
export interface SchedulerEntry {
  id: string
  roleId: string
  agentProfileId: string
  modelId: string
  kind: 'engine' | 'museCode' | 'external'
  /** Pool/accounting supplies 0.9 ** placesAfterFirstWithHeadroom. */
  poolFit: number
  remainingDayTokens: number
  eligible(task: TeamBoardTask): boolean
}
export interface PickContext {
  now: number
  entries: readonly SchedulerEntry[]
  canStart(task: TeamBoardTask, entry: SchedulerEntry): boolean
  estimatedTokens(task: TeamBoardTask): number
  minutes(task: TeamBoardTask): number
  landingOverlap(task: TeamBoardTask): boolean
  /** Waiter -> holder, including lease and merge-queue waits. */
  waits: readonly { waiter: string; holder: string }[]
  youngerStarted(task: TeamBoardTask): boolean
  conversationWeight(sessionId: string): number
  agingMs?: number
  starvationMs?: number
}
export interface ScoredPick {
  task: TeamBoardTask
  entry: SchedulerEntry
  priorityWeight: number
  criticalPathFactor: number
  fit: number
  score: number
  starved: boolean
}

/** Recomputed from live waiters; inherited priority disappears with the wait. */
export function inheritedPriorities(
  tasks: readonly TeamBoardTask[],
  waits: PickContext['waits'],
  now: number,
  agingMs = TEAM_AGING_MS,
): ReadonlyMap<string, Priority> {
  const levels = new Map(
    tasks.map((task) => {
      const aging =
        task.state === 'ready' && task.readyAt !== undefined
          ? Math.floor(Math.max(0, now - task.readyAt) / agingMs)
          : 0
      return [task.id, Math.min(priorities.length - 1, priorities.indexOf(task.priority) + aging)]
    }),
  )
  const edges = [
    ...waits,
    ...tasks.flatMap((task) =>
      (task.depends_on ?? [])
        .filter((edge) => {
          const dependency = tasks.find((item) => item.id === edge.task)
          return (
            dependency &&
            (edge.on === 'merged'
              ? dependency.state !== 'merged'
              : !['done', 'merged'].includes(dependency.state))
          )
        })
        .map((edge) => ({ waiter: task.id, holder: edge.task })),
    ),
  ]
  for (const _task of tasks) {
    let isChanged = false
    for (const edge of edges) {
      const holder = levels.get(edge.holder)
      const waiter = levels.get(edge.waiter)
      if (!(holder !== undefined && waiter !== undefined && waiter > holder)) {
        continue
      }

      levels.set(edge.holder, waiter)
      isChanged = true
    }
    if (!isChanged) break
  }
  return new Map([...levels].map(([id, level]) => [id, priorities[level] ?? 'urgent']))
}

/** Smooth weighted round robin across eligible conversations; rank within each. */
export class TaskPicker {
  private readonly credits = new Map<string, number>()
  private readonly processStarts = new Map<string, number>()

  started(entry: SchedulerEntry, at: number): void {
    if (entry.kind !== 'engine') this.processStarts.set(entry.agentProfileId, at)
  }

  rank(tasks: readonly TeamBoardTask[], context: PickContext): readonly ScoredPick[] {
    const paths = criticalPaths(tasks, (task) => context.minutes(task))
    const longest = Math.max(1, ...paths.values())
    const inherited = inheritedPriorities(tasks, context.waits, context.now, context.agingMs)
    const ranked: ScoredPick[] = []
    for (const task of tasks) {
      if (task.state !== 'ready' || task.held) continue
      for (const entry of context.entries) {
        const last = this.processStarts.get(entry.agentProfileId)
        if (
          entry.roleId !== task.roleId ||
          !entry.eligible(task) ||
          !context.canStart(task, entry) ||
          (last !== undefined &&
            entry.kind !== 'engine' &&
            context.now - last < TEAM_START_STAGGER_MS)
        )
          continue
        const fit =
          entry.poolFit *
          (entry.remainingDayTokens >= context.estimatedTokens(task) ? 1 : 1 / 2) *
          (context.landingOverlap(task) ? 1 / 2 : 1)
        if (!(fit > 0 && fit <= 1)) continue
        const priorityWeight = TEAM_PRIORITY_WEIGHTS[inherited.get(task.id) ?? task.priority]
        const criticalPathFactor = 1 + (paths.get(task.id) ?? 0) / longest
        ranked.push({
          task,
          entry,
          priorityWeight,
          criticalPathFactor,
          fit,
          score: priorityWeight * criticalPathFactor * fit,
          starved:
            context.now - (task.readyAt ?? context.now) >=
              (context.starvationMs ?? TEAM_STARVATION_MS) && context.youngerStarted(task),
        })
      }
    }
    return ranked.toSorted(
      (left, right) =>
        Number(right.starved) - Number(left.starved) ||
        (left.starved && right.starved
          ? (left.task.readyAt ?? 0) - (right.task.readyAt ?? 0)
          : right.score - left.score) ||
        (left.task.readyAt ?? 0) - (right.task.readyAt ?? 0) ||
        left.task.id.localeCompare(right.task.id) ||
        left.entry.id.localeCompare(right.entry.id),
    )
  }

  pick(tasks: readonly TeamBoardTask[], context: PickContext): ScoredPick | undefined {
    const ranked = this.rank(tasks, context)
    const starved = ranked.find((item) => item.starved)
    if (starved) return starved
    const sessions = new Set(ranked.map((item) => item.task.parentSessionId))
    let chosen: string | undefined
    let best = -Infinity
    let total = 0
    for (const session of sessions) {
      const weight = context.conversationWeight(session)
      if (!Number.isFinite(weight) || weight <= 0) throw new Error('team:conversationWeight')
      total += weight
      const credit = (this.credits.get(session) ?? 0) + weight
      this.credits.set(session, credit)
      if (!(credit > best)) {
        continue
      }

      chosen = session
      best = credit
    }
    if (chosen === undefined) return undefined
    this.credits.set(chosen, best - total)
    for (const session of this.credits.keys())
      if (!sessions.has(session)) this.credits.delete(session)
    return ranked.find((item) => item.task.parentSessionId === chosen)
  }
}
