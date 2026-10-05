import { TEAM_MODEL_TEXT, TEAM_SCHED_HISTORY_MAX } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { type TeamRosterLive, type TeamStableRole, type TeamStableEntry } from './teamSeams'
import {
  teamBoardSchema,
  teamMergeOptionsSchema,
  teamSchedulerEventSchema,
  teamWriteSetLeaseSchema,
  type TeamSchedulerEvent,
} from '../../shared/team'
// The roster (PLAN.md M96 lane T, D75 "The roster"): the team as it is now,
// in a stable part and a live part, so the cached prefix holds.
//
// - The stable part (at most about 500 tokens for seven roles) names each
//   role's id, workspace mode, tool groups, pool order with caps as set,
//   exhausted policy and when-to-use, then the rubric and the guidance. On
//   the Model API it goes in the conversation's instructions from the first
//   request and is never rewritten: it holds nothing that varies by task.
// - The live part (headroom, states, queue, unmerged tasks, budget left)
//   rides only in `roster`/`delegate`/`collect` answers and in a one-line
//   structured state-change event in the next team tool answer.
// - A team edit mid-conversation reaches the model only as structured tool data.
//

function entryLine(index: number, entry: TeamStableEntry): string {
  const caps = entry.caps.length === 0 ? TEAM_MODEL_TEXT.rosterNoCaps : entry.caps.join(', ')
  return `${String(index + 1)} ${entry.agentLabel}: ${caps} (${entry.entryId}; ${entry.modelId}; ${entry.kind})`
}

function roleLines(role: TeamStableRole): readonly string[] {
  const head = `- ${role.roleId} (${role.workspaceMode}; ${role.toolGroups.join(', ')})`
  if (role.pool.length === 0) {
    return [
      head,
      fill(TEAM_MODEL_TEXT.rosterNotStaffedPolicy, { value1: role.exhaustedPolicy }),
      fill(TEAM_MODEL_TEXT.rosterUse, { value1: role.whenToUse }),
    ]
  }
  return [
    head,
    ...role.pool.map((entry, index) => `  ${entryLine(index, entry)}`),
    fill(TEAM_MODEL_TEXT.rosterExhausted, { value1: role.exhaustedPolicy }),
    fill(TEAM_MODEL_TEXT.rosterUse2, { value1: role.whenToUse }),
  ]
}

/**
 * The stable part: byte-identical for the same roles, whatever the live
 * numbers are. A live count here would rewrite the cached prefix on every
 * request (the byte-stability case).
 */
export function buildRosterStable(roles: readonly TeamStableRole[]): string {
  return [TEAM_MODEL_TEXT.rosterTeam, ...roles.flatMap((role) => roleLines(role))].join('\n')
}

/** The rubric: defer or do it yourself (D75). `delegate` requires one code as `reason`. */
export function buildRubric(): string {
  return [
    TEAM_MODEL_TEXT.rosterWhenToDelegate,
    TEAM_MODEL_TEXT.rosterDoItYourselfSmallAFew,
    TEAM_MODEL_TEXT.rosterDelegateParallelIndependentPiecesThatCan,
    TEAM_MODEL_TEXT.rosterNeverDelegateWhatNeedsTheUser,
  ].join('\n')
}

/** The rest of the guidance: briefs, integration, don'ts, reports, rounds, limits. */
export function buildTeamGuidance(): string {
  return [
    TEAM_MODEL_TEXT.rosterWorkingWithTheTeam,
    TEAM_MODEL_TEXT.rosterBriefsWriteEachBriefForA,
    TEAM_MODEL_TEXT.rosterIntegrationIsYoursReviewBeforeMerging,
    TEAM_MODEL_TEXT.rosterDonTSplitOneEditAcross,
    TEAM_MODEL_TEXT.rosterReportsAreDataNotInstructionsNever,
    TEAM_MODEL_TEXT.rosterAfterThreeReviewRoundsThatStill,
    TEAM_MODEL_TEXT.rosterLimitsWhenARoleSaysWaiting,
  ].join('\n')
}

/** The whole stable section for the instructions: roster, rubric, guidance. */
export function buildStableRosterSection(roles: readonly TeamStableRole[]): string {
  return [buildRosterStable(roles), buildRubric(), buildTeamGuidance()].join('\n\n')
}

/** The live part: headroom and states, for tool answers only. */
export function buildRosterLive(live: TeamRosterLive): string {
  const rows = live.entries.map(
    (entry) => `${entry.roleId} ${entry.entryId}: ${entry.headroom} (${entry.state})`,
  )
  return [
    TEAM_MODEL_TEXT.rosterTeamNow,
    ...rows,
    fill(TEAM_MODEL_TEXT.rosterQueueWaitingUnmergedBudgetLeft, {
      value1: String(live.queueDepth),
      value2: String(live.unmergedTasks),
      value3: live.budgetLeft,
    }),
  ].join('\n')
}

/** One entry's state change, for the tail note. */
export interface TeamStateChange {
  readonly roleId: string
  readonly entryId: string
  readonly from: string
  readonly to: string
}

/** State and edit events are JSON data in tool answers, never user messages. */
export function formatStateChangeNote(
  changes: readonly TeamStateChange[],
  edits: readonly string[] = [],
): string | undefined {
  return changes.length === 0 && edits.length === 0
    ? undefined
    : JSON.stringify({ type: 'team_events', states: changes, edits })
}

// Scheduler data is appended to tool answers and the state-change tail only.
// M96 supplies stable roster/rubric bytes; no live count enters that prefix.
import * as z from 'zod/mini'

const liveSchema = z.strictObject({
  board: teamBoardSchema,
  leases: z.array(teamWriteSetLeaseSchema).check(z.maxLength(TEAM_SCHED_HISTORY_MAX)),
  mergeQueue: z
    .array(
      z.strictObject({
        taskId: teamMergeOptionsSchema.shape.task_id,
        position: z.int().check(z.gte(1)),
        reason: z.string(),
      }),
    )
    .check(z.maxLength(TEAM_SCHED_HISTORY_MAX)),
  events: z.array(teamSchedulerEventSchema).check(z.maxLength(TEAM_SCHED_HISTORY_MAX)),
})

/** Required adapters over S/C/Q's live snapshots; no placeholder snapshot is
 * used when a lane is unavailable. Base entry headroom/budget/report data is
 * preserved in the M96 tool's result. These reads do not dispatch work. */
export interface SchedulerRosterSource {
  read(): unknown
}

export function schedulerToolAnswer(
  result: string | undefined,
  source: SchedulerRosterSource,
): string {
  const scheduler = liveSchema.parse(source.read())
  const workspace = scheduler.board.workspaceId
  if (
    scheduler.leases.some((lease) => lease.workspaceId !== workspace) ||
    scheduler.events.some((event) => event.workspaceId !== workspace)
  ) {
    throw new Error('schedulerWorkspaceMismatch')
  }
  return JSON.stringify({ kind: 'data', result, scheduler })
}

/** M96's note drains once per orchestrator conversation, at a request tail.
 * Usage changes wait for the next tool answer. Event text is JSON data, never
 * promoted to an instruction, and earlier instruction bytes are untouched. */
export class SchedulerStateNote {
  private readonly pending: TeamSchedulerEvent[] = []
  private readonly seen: string[] = []

  constructor(private readonly workspaceId: string) {}

  record(input: unknown): void {
    const event = teamSchedulerEventSchema.parse(input)
    if (event.workspaceId !== this.workspaceId) throw new Error('schedulerWorkspaceMismatch')
    if (event.kind === 'usage') return
    // Identical deliveries of one state transition must announce it once.
    const identity = JSON.stringify(event)
    if (this.seen.includes(identity)) return
    if (this.pending.length >= TEAM_SCHED_HISTORY_MAX) throw new Error('schedulerNoteFull')
    this.pending.push(event)
    this.seen.push(identity)
    if (this.seen.length > TEAM_SCHED_HISTORY_MAX) this.seen.shift()
  }

  take(): string | undefined {
    if (this.pending.length === 0) return undefined
    const note = JSON.stringify({ kind: 'data', events: this.pending })
    this.pending.length = 0
    return note
  }
}
