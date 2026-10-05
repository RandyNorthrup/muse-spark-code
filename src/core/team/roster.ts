import { TEAM_MODEL_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
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

import type { TeamRosterLive, TeamStableRole, TeamStableEntry } from './teamSeams'

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
