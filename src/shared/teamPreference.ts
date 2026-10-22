import {
  REVIEW_SEVERITIES,
  TEAM_BORROW_COOLDOWN_MS,
  TEAM_BORROW_DEMAND_WAIT_MIN_MS,
  TEAM_BORROW_DEMAND_WAIT_MS,
  TEAM_BORROW_FINISH_GRACE_MS,
  TEAM_BORROW_LOOKAHEAD_MS,
  TEAM_BORROW_RECALL_WAIT_MS,
} from './constants'
import { teamPoolEntrySchema, teamRoleConfigSchema } from './team'
// Preferred agents, availability, handoff and secondary roles (M120 lane 0,
// PLAN.md D103 and D212). One preference model: a candidate is D75's pool
// entry plus its device or node and its conditions, and a preference list is
// D75's role config with candidates for entries. Lanes S, H, P and W import
// these shapes; nothing here selects, moves or shows anything.
//
// Shared by host and webview: no `vscode`, Node, or DOM imports.

import * as z from 'zod/mini'

const idSchema = z.string().check(z.minLength(1))
const timeSchema = z.int().check(z.nonnegative())
const countSchema = z.int().check(z.nonnegative())
const uniqueIds = z.array(idSchema).check(z.refine((ids) => new Set(ids).size === ids.length))

// The platforms a candidate can run on (D103's capability facts).
export const teamPlatforms = ['windows', 'macos', 'linux'] as const
export const teamPlatformSchema = z.enum(teamPlatforms)
export type TeamPlatform = z.infer<typeof teamPlatformSchema>

/**
What a candidate can do, as capability facts, never vendor names. An absent
list is unknown, and an unknown fact never meets a task that requires it.
*/
export const teamCandidateConditionsSchema = z.object({
  platforms: z.optional(z.array(teamPlatformSchema)),
  /** Tool and feature facts, e.g. `tools.write`, `vision`. */
  features: z.optional(z.array(idSchema)),
})
export type TeamCandidateConditions = z.infer<typeof teamCandidateConditionsSchema>

/** What a task requires, and who authored the work a review task reviews. */
export const teamTaskConditionsSchema = z.object({
  platform: z.optional(teamPlatformSchema),
  features: z.optional(z.array(idSchema)),
  /** Candidates and engines that wrote the work: none of them may review it. */
  authorCandidates: z.optional(z.array(idSchema)),
  authorEngines: z.optional(z.array(idSchema)),
})
export type TeamTaskConditions = z.infer<typeof teamTaskConditionsSchema>

/** One candidate: a D75 pool entry, with its device or node and its conditions. */
export const teamCandidateSchema = z.extend(teamPoolEntrySchema, {
  /** The device or node it runs on (M100/M110); absent is this machine. */
  node: z.optional(idSchema),
  conditions: z.optional(teamCandidateConditionsSchema),
})
export type TeamCandidate = z.infer<typeof teamCandidateSchema>

// Area hints on a coding role's charter (D103): path globs and plain-word kinds.
export const teamAreaHintsSchema = z.object({
  globs: z.array(idSchema),
  kinds: z.array(idSchema),
})
export type TeamAreaHints = z.infer<typeof teamAreaHintsSchema>

/**
D212's per-role timers, in milliseconds. The demand wait never goes below
its floor; every timer has the plan's default.
*/
export const teamBorrowTimersSchema = z.object({
  demandWaitMs: z._default(
    z.int().check(z.gte(TEAM_BORROW_DEMAND_WAIT_MIN_MS)),
    TEAM_BORROW_DEMAND_WAIT_MS,
  ),
  lookaheadMs: z._default(timeSchema, TEAM_BORROW_LOOKAHEAD_MS),
  finishGraceMs: z._default(timeSchema, TEAM_BORROW_FINISH_GRACE_MS),
  recallWaitMs: z._default(timeSchema, TEAM_BORROW_RECALL_WAIT_MS),
  cooldownMs: z._default(timeSchema, TEAM_BORROW_COOLDOWN_MS),
})
export type TeamBorrowTimers = z.infer<typeof teamBorrowTimersSchema>

/** A role's preference list: D75's role config, its entries as candidates. */
export const teamPreferenceListSchema = z.extend(teamRoleConfigSchema, {
  pool: z.array(teamCandidateSchema),
  areaHints: z.optional(teamAreaHintsSchema),
  borrow: z.optional(teamBorrowTimersSchema),
  /**
  Opt-in auto-order (D103, M120 lane 5): only while true may recorded
  outcomes reorder this pool, and only as the suggestion orders it.
  Absent is off, so a D75 role config still parses to the same value.
  */
  autoOrder: z.optional(z.boolean()),
})
export type TeamPreferenceList = z.infer<typeof teamPreferenceListSchema>

/** An agent's main role and its secondary roles, in order (D212). */
export const teamRoleAssignmentSchema = z
  .object({
    candidateId: idSchema,
    mainRole: idSchema,
    secondaryRoles: uniqueIds,
  })
  .check(z.refine((value) => !value.secondaryRoles.includes(value.mainRole)))
export type TeamRoleAssignment = z.infer<typeof teamRoleAssignmentSchema>

// Why a candidate was passed over (D103's live checks, D212's borrow rules).
export const teamSkipReasons = [
  'signedOut',
  'unhealthy',
  'capped',
  'rateLimited',
  'coolingDown',
  'nodeOffline',
  'notAdmitted',
  'conditions',
  'author',
  'busy',
  'mainWorkDue',
  'borrowCooldown',
] as const
export const teamSkipReasonSchema = z.enum(teamSkipReasons)
export type TeamSkipReason = z.infer<typeof teamSkipReasonSchema>

/** One skipped candidate and why; `untilMs` where the reason lapses at a time. */
export const teamSkipSchema = z.object({
  candidateId: idSchema,
  reason: teamSkipReasonSchema,
  untilMs: z.optional(timeSchema),
})
export type TeamSkip = z.infer<typeof teamSkipSchema>

/** A live probe's answer for one candidate, checked when the task starts. */
export type TeamAvailability =
  { readonly available: true } | { readonly available: false; readonly skip: TeamSkip }

/** Lane S implements this over sign-in, health, caps, marks, nodes and the governor. */
export interface TeamAvailabilityProbe {
  probe(candidate: TeamCandidate, nowMs: number): TeamAvailability
}

export {
  teamMoveTriggers,
  teamMoveTriggerSchema,
  teamCapturedWorkSchema,
  teamRecallEndings,
  teamChainEntrySchema,
  teamHandoffRecordSchema,
  type TeamMoveTrigger,
  type TeamCapturedWork,
  type TeamRecallEnding,
  type TeamChainEntry,
  type TeamHandoffRecord,
} from './teamHandoff'

/** Per-role, per-candidate outcomes (D103): what a reorder suggestion reads. */
export const teamOutcomeStatsSchema = z.object({
  roleId: idSchema,
  candidateId: idSchema,
  tasks: countSchema,
  firstReviewAccepted: countSchema,
  findings: z.record(z.enum(REVIEW_SEVERITIES), countSchema),
  roundsToAcceptance: countSchema,
  durationMs: timeSchema,
  redesigns: countSchema,
})
export type TeamOutcomeStats = z.infer<typeof teamOutcomeStatsSchema>

/** Whether a candidate meets a task's conditions; unknown facts never meet a requirement. */
export function canMeetTaskConditions(
  candidate: TeamCandidateConditions | undefined,
  task: TeamTaskConditions | undefined,
): boolean {
  if (task?.platform !== undefined && !(candidate?.platforms ?? []).includes(task.platform)) {
    return false
  }
  const features = candidate?.features ?? []
  return (task?.features ?? []).every((feature) => features.includes(feature))
}

/** Whether the candidate, or its engine, authored the work the task reviews. */
export function isTaskAuthor(
  candidateId: string,
  engine: string,
  task: TeamTaskConditions | undefined,
): boolean {
  return (
    (task?.authorCandidates ?? []).includes(candidateId) ||
    (task?.authorEngines ?? []).some((author) => author.trim() === engine.trim())
  )
}
