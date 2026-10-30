import { isResourceSlotAvailable, type TeamCapacityPort } from './slots'
import { isDependencySatisfied } from './dependencies'
import { stealPolicy, type StolenPolicy } from './steal'
import type { RoleDefinition } from '../roles'

/** Input is M96c's already eligible, fairly ordered local work; keep that order. */
export function pickResourceReady<T extends { readonly kind: 'worker' | 'check' }>(
  ordered: readonly T[],
  capacity: TeamCapacityPort,
): T | undefined {
  return ordered.find((task) => isResourceSlotAvailable(capacity, task.kind))
}

import {
  TEAM_AGING_MS,
  TEAM_PRIORITY_WEIGHTS,
  TEAM_STARVATION_MS,
  TEAM_START_STAGGER_MS,
} from '../../../shared/constants'
import type { TeamBoardTask } from '../../../shared/team'
import { criticalPaths } from './criticalPath'
import { selectTeamEntry } from '../selection'
import type { TeamSelectionSnapshot, TeamSelection } from '../teamPool'
import { TEAM_TASKS_PER_TURN_DEFAULT } from '../../../shared/constants'
import type { TeamSkip } from '../../../shared/teamPreference'
import { isSameTeamModel } from '../sameModel'

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
  /** The person's machine-resource governor (M107): picks keep their fair
  order, but only resource-ready work starts. Absent, nothing is gated. */
  capacity?: TeamCapacityPort | undefined
  /** Lane W supplies the installed facts; absent keeps D75 ranking unchanged. */
  selection?(task: TeamBoardTask): TeamSelectionSnapshot
  selected?(task: TeamBoardTask, selection: TeamSelection): void
  now: number
  entries: readonly SchedulerEntry[]
  /**
  Role policies for cross-role steals (M96d): absent, unknown roles
  and refused meets all keep M96c's same-role behaviour.
  */
  roles?: (roleId: string) => RoleDefinition | undefined
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
  /** The stolen policy both roles admit; undefined runs the task's own role. */
  stolenPolicy: StolenPolicy | undefined
}

/** A steal the task lists and both roles admit, or undefined for own-role work. */
function stealForTask(
  task: TeamBoardTask,
  roleId: string,
  context: PickContext,
): StolenPolicy | undefined {
  if (task.alt_roles?.includes(roleId) !== true) return undefined
  const roles = context.roles
  if (roles === undefined) return undefined
  const from = roles(task.roleId)
  const to = roles(roleId)
  if (from === undefined || to === undefined) return undefined
  const stolen = stealPolicy(task, from, to)
  return stolen.ok ? stolen.policy : undefined
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
  const waiting = tasks.filter((task) =>
    ['queued', 'ready', 'running', 'blocked', 'review', 'merge'].includes(task.state),
  )
  const edges = [
    ...waits.filter((edge) => waiting.some((task) => task.id === edge.waiter)),
    ...waiting.flatMap((task) =>
      (task.depends_on ?? [])
        .filter((edge) => {
          const dependency = tasks.find((item) => item.id === edge.task)
          return dependency && !isDependencySatisfied(edge.on, dependency.state)
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
    const longest = Math.max(0, ...paths.values())
    const inherited = inheritedPriorities(tasks, context.waits, context.now, context.agingMs)
    const ranked: ScoredPick[] = []
    for (const task of tasks) {
      if (task.state !== 'ready' || task.held) continue
      const snapshot = context.selection?.(task)
      let preferredId: string | undefined
      if (snapshot?.preference !== undefined) {
        const availability = snapshot.availability
        if (availability === undefined) throw new Error('team:availabilityMissing')
        const selection = selectTeamEntry(
          { roleId: task.roleId, entries: [], policy: 'queue', continueOnNext: false },
          {
            ...snapshot,
            nowMs: context.now,
            availability: {
              probe: (candidate, nowMs) => {
                const live = availability.probe(candidate, nowMs)
                if (!live.available) return live
                const entry = context.entries.find(
                  (item) => item.id === candidate.id && item.roleId === task.roleId,
                )
                const last =
                  entry === undefined ? undefined : this.processStarts.get(entry.agentProfileId)
                let reason: TeamSkip['reason'] | undefined
                const agent = candidate.agent
                const profileId = agent?.agentId ?? snapshot.defaultAgent.key
                const modelId = agent?.model ?? snapshot.defaultAgent.modelId
                const kind = agent?.kind ?? snapshot.defaultAgent.kind
                if (entry === undefined) reason = 'nodeOffline'
                else if (
                  entry.agentProfileId !== profileId ||
                  !isSameTeamModel(entry.modelId, modelId) ||
                  entry.kind !== kind
                )
                  reason = 'unhealthy'
                else if (!entry.eligible(task)) reason = 'conditions'
                else if (!context.canStart(task, entry)) reason = 'notAdmitted'
                else if (
                  last !== undefined &&
                  entry.kind !== 'engine' &&
                  nowMs - last < TEAM_START_STAGGER_MS
                )
                  reason = 'coolingDown'
                return reason === undefined
                  ? live
                  : { available: false, skip: { candidateId: candidate.id, reason } }
              },
            },
          },
          TEAM_TASKS_PER_TURN_DEFAULT,
        )
        context.selected?.(task, selection)
        if (selection.kind !== 'selected') continue
        preferredId = selection.entry.id
      }
      for (const entry of context.entries) {
        const last = this.processStarts.get(entry.agentProfileId)
        // A listed, admitted steal competes below its own role's lanes.
        const stolen =
          entry.roleId === task.roleId ? undefined : stealForTask(task, entry.roleId, context)
        if (
          (stolen === undefined && entry.roleId !== task.roleId) ||
          (preferredId !== undefined && entry.id !== preferredId) ||
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
          (context.landingOverlap(task) ? 1 / 2 : 1) *
          (stolen === undefined ? 1 : 1 / 2)
        if (!(fit > 0 && fit <= 1)) continue
        const priorityWeight = TEAM_PRIORITY_WEIGHTS[inherited.get(task.id) ?? task.priority]
        const criticalPathFactor = longest > 0 ? 1 + (paths.get(task.id) ?? 0) / longest : 1
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
          stolenPolicy: stolen,
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
    // The governor join (M107): fair order stands, but a pick the machine
    // cannot resource right now waits for the next sweep instead of starting.
    const isReady = (item: ScoredPick): boolean =>
      context.capacity === undefined ||
      pickResourceReady([{ ...item, kind: 'worker' as const }], context.capacity) !== undefined
    const starved = ranked.find((item) => item.starved)
    if (starved && isReady(starved)) return starved
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
    const sessionPicks = ranked.filter((item) => item.task.parentSessionId === chosen)
    return context.capacity === undefined
      ? sessionPicks[0]
      : pickResourceReady(
          sessionPicks.map((item) => ({ ...item, kind: 'worker' as const })),
          context.capacity,
        )
  }
}
