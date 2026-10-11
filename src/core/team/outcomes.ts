// Per-role, per-candidate outcome stats, reorder suggestions and opt-in
// auto-order (D103, M120 lane 5): "which agent is better at what is learned,
// not guessed". Pure functions over the lane-0 record; no `vscode`, Node or
// DOM imports. Lanes P (panel) and W (wiring) consume these; nothing here
// selects, moves or shows anything by itself.

import * as z from 'zod/mini'
import {
  REVIEW_SEVERITIES,
  TEAM_LEARNED_MIN_TASKS,
  TEAM_OUTCOME_MIN_RATE_GAP,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import {
  teamOutcomeStatsSchema,
  teamPreferenceListSchema,
  type TeamOutcomeStats,
  type TeamPreferenceList,
} from '../../shared/teamPreference'

const idSchema = z.string().check(z.minLength(1))

/**
 * One finished task that went through review. Findings ride as one entry
 * per finding (the history row's `findingSeverities` shape); the recorder
 * counts them by severity. Only reviewed tasks are recorded: every metric
 * the stats keep (acceptance, findings, rounds, time, redesigns) needs one.
 */
export const teamTaskOutcomeSchema = z.object({
  roleId: idSchema,
  candidateId: idSchema,
  /** Rounds the task needed to pass review; 1 when accepted on first review. */
  roundsToAcceptance: z.int().check(z.gte(1)),
  /** One entry per review finding, by severity. */
  findings: z.array(z.enum(REVIEW_SEVERITIES)),
  durationMs: z.int().check(z.nonnegative()),
  /** True when the task had to be redesigned, not just fixed up. */
  redesign: z.boolean(),
})
export type TeamTaskOutcome = z.infer<typeof teamTaskOutcomeSchema>

/** A zeroed record for a role and candidate pair with no history yet. */
function zeroStats(roleId: string, candidateId: string): TeamOutcomeStats {
  return teamOutcomeStatsSchema.parse({
    roleId,
    candidateId,
    tasks: 0,
    firstReviewAccepted: 0,
    findings: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    roundsToAcceptance: 0,
    durationMs: 0,
    redesigns: 0,
  })
}

/**
 * Folds one finished task into its role and candidate record. A record for
 * another role or candidate is refused, never merged: mixing pairs would
 * teach the wrong lesson. Findings add to their severities; first-review
 * acceptance is rounds of exactly one.
 */
export function recordOutcome(
  current: TeamOutcomeStats | undefined,
  outcome: TeamTaskOutcome,
): TeamOutcomeStats {
  const event = teamTaskOutcomeSchema.parse(outcome)
  const base =
    current === undefined
      ? zeroStats(event.roleId, event.candidateId)
      : teamOutcomeStatsSchema.parse(current)
  if (base.roleId !== event.roleId || base.candidateId !== event.candidateId) {
    throw new Error('team outcome belongs to another role or candidate')
  }
  const findings = { ...base.findings }
  for (const severity of event.findings) {
    findings[severity] += 1
  }
  return teamOutcomeStatsSchema.parse({
    roleId: base.roleId,
    candidateId: base.candidateId,
    tasks: base.tasks + 1,
    firstReviewAccepted: base.firstReviewAccepted + (event.roundsToAcceptance === 1 ? 1 : 0),
    findings,
    roundsToAcceptance: base.roundsToAcceptance + event.roundsToAcceptance,
    durationMs: base.durationMs + event.durationMs,
    redesigns: base.redesigns + (event.redesign ? 1 : 0),
  })
}

/** What a reorder suggestion reads: the role, its current pool order and the records. */
export interface RoleReorderInput {
  readonly roleId: string
  /** Current pool order, most preferred first. */
  readonly order: readonly string[]
  /** Recorded stats; entries for other roles are ignored. */
  readonly stats: readonly TeamOutcomeStats[]
}

/** A suggested pool order with its reason in the display language. */
export interface RoleReorderSuggestion {
  readonly roleId: string
  readonly suggestedOrder: readonly string[]
  readonly reason: string
}

interface ScoredCandidate {
  readonly candidateId: string
  readonly rate: number
  readonly findingsPerTask: number
  readonly roundsPerTask: number
  readonly accepted: number
  readonly tasks: number
}

function totalFindings(stats: TeamOutcomeStats): number {
  return REVIEW_SEVERITIES.reduce((sum, severity) => sum + stats.findings[severity], 0)
}

/** Best first: acceptance rate, then fewer findings, then fewer rounds, then id. */
function compareScored(a: ScoredCandidate, b: ScoredCandidate): number {
  if (a.rate !== b.rate) {
    return b.rate - a.rate
  }
  if (a.findingsPerTask !== b.findingsPerTask) {
    return a.findingsPerTask - b.findingsPerTask
  }
  if (a.roundsPerTask !== b.roundsPerTask) {
    return a.roundsPerTask - b.roundsPerTask
  }
  if (a.candidateId === b.candidateId) {
    return 0
  }
  return a.candidateId < b.candidateId ? -1 : 1
}

/** Whether the challenger clearly beats the incumbent: ranked better by a clear rate gap. */
function isClearImprovement(challenger: ScoredCandidate, incumbent: ScoredCandidate): boolean {
  return (
    compareScored(challenger, incumbent) < 0 &&
    challenger.rate - incumbent.rate + Number.EPSILON >= TEAM_OUTCOME_MIN_RATE_GAP
  )
}

/**
 * The first misplaced pair in current order: the most preferred qualifying
 * candidate that a clearly better one stands behind, with that better one.
 */
function findPassingPair(
  placed: readonly string[],
  scored: ReadonlyMap<string, ScoredCandidate>,
): { readonly worse: ScoredCandidate; readonly better: ScoredCandidate } | undefined {
  for (let i = 0; i < placed.length; i += 1) {
    const incumbent = scored.get(placed[i] ?? '')
    if (incumbent === undefined) {
      continue
    }
    for (let j = i + 1; j < placed.length; j += 1) {
      const challenger = scored.get(placed[j] ?? '')
      if (challenger === undefined) {
        continue
      }
      if (isClearImprovement(challenger, incumbent)) {
        return { worse: incumbent, better: challenger }
      }
    }
  }
  return undefined
}

/**
 * Suggests a reorder when one candidate is clearly better for the role: both
 * it and the candidate it passes have at least TEAM_LEARNED_MIN_TASKS tasks,
 * and its first-review acceptance rate leads by TEAM_OUTCOME_MIN_RATE_GAP.
 * Candidates below the evidence bar keep their slots, so thin evidence never
 * moves anyone. Returns undefined when the current order already holds, or
 * when no gap is clear. Deterministic on every platform: no locale compare.
 */
export function suggestRoleReorder(input: RoleReorderInput): RoleReorderSuggestion | undefined {
  const roleId = idSchema.parse(input.roleId)
  const order = input.order.map((id) => idSchema.parse(id))
  const records = input.stats.map((stats) => teamOutcomeStatsSchema.parse(stats))
  const byId = new Map<string, TeamOutcomeStats>()
  for (const stats of records) {
    if (!byId.has(stats.candidateId) && stats.roleId === roleId) {
      byId.set(stats.candidateId, stats)
    }
  }
  const scored = new Map<string, ScoredCandidate>()
  for (const stats of byId.values()) {
    if (stats.tasks >= TEAM_LEARNED_MIN_TASKS) {
      scored.set(stats.candidateId, {
        candidateId: stats.candidateId,
        rate: stats.firstReviewAccepted / stats.tasks,
        findingsPerTask: totalFindings(stats) / stats.tasks,
        roundsPerTask: stats.roundsToAcceptance / stats.tasks,
        accepted: stats.firstReviewAccepted,
        tasks: stats.tasks,
      })
    }
  }
  const placed = order.filter((id) => scored.has(id))
  const pair = findPassingPair(placed, scored)
  if (pair === undefined) {
    return undefined
  }
  const { worse, better } = pair
  const ranked = placed.toSorted((a, b) => {
    const left = scored.get(a)
    const right = scored.get(b)
    return left === undefined || right === undefined ? 0 : compareScored(left, right)
  })
  const slots = order.map((id) => (scored.has(id) ? (ranked.shift() ?? id) : id))
  return {
    roleId,
    suggestedOrder: slots,
    reason: fill(UI_TEXT.teamOutcomeReorderReason, {
      better: better.candidateId,
      betterAccepted: better.accepted,
      betterTasks: better.tasks,
      role: roleId,
      worse: worse.candidateId,
      worseAccepted: worse.accepted,
      worseTasks: worse.tasks,
    }),
  }
}

/**
 * Applies the suggestion to a preference list, but only while the role opted
 * in with `autoOrder`: anything else returns the list unchanged. The pool is
 * reordered exactly as the suggestion orders it; unknown ids never appear.
 */
export function applyRoleAutoOrder(
  list: TeamPreferenceList,
  stats: readonly TeamOutcomeStats[],
): TeamPreferenceList {
  const parsed = teamPreferenceListSchema.parse(list)
  if (parsed.autoOrder !== true) {
    return list
  }
  const suggestion = suggestRoleReorder({
    roleId: parsed.role,
    order: parsed.pool.map((candidate) => candidate.id),
    stats,
  })
  if (suggestion === undefined) {
    return list
  }
  const byId = new Map(parsed.pool.map((candidate) => [candidate.id, candidate]))
  const pool = suggestion.suggestedOrder
    .map((id) => byId.get(id))
    .filter((candidate) => candidate !== undefined)
  return { ...parsed, pool }
}
