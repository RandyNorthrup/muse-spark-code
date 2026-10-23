// D107 (M125 lane U): one turn's fast-judge record. Both backends emit it
// when the turn ends and at least one fast decision was evaluated; with
// the switch off nothing is emitted. Each entry names the decision, how
// many times it was evaluated, whether its condition was raised at least
// once and whether the host acted on it at least once, with the primary
// outcome token. Raised reports the condition (or a forced one); acted
// reports what the host applied. Judges spend nothing on a deterministic
// turn: calls and tokens are observed zeros, never estimates. Saved time,
// saved tokens and avoided calls are not on this event: only lane V's
// paired arms can measure them, and the panel shows unknown until they do.
import * as z from 'zod/mini'

/**
The decisions a turn can report. The ten M125 reflex decisions; M98's
`risk.destructive` stays under the caution judge's own rows. Kept
aligned with `FAST_DECISIONS` in src/core/judge/fast/classes.ts.
*/
export const JUDGE_FAST_TURN_DECISIONS = [
  'triage.needFull',
  'context.include',
  'loop.stuck',
  'effort.lower',
  'skill.fit',
  'edit.misfit',
  'failure.unmentioned',
  'scope.outside',
  'claim.inconsistent',
  'done.unbacked',
] as const
export type JudgeFastTurnDecision = (typeof JUDGE_FAST_TURN_DECISIONS)[number]

/**
One decision's primary outcome for the turn. A loop names its pattern;
triage names pack, the whole-output fallback, or why no engine was
asked; effort names the lowering, the already-lowest level, or a broad
request; keep names kept or the empty request; done names the queued
note, the surface note, or no claim; failure names the hint, the
mention, or nothing found. `pinned` means the evaluation pin decided
the outcome, not the verdict.
*/
export const JUDGE_FAST_TURN_REASONS = [
  'repeat',
  'oscillation',
  'same-failure',
  'pack',
  'whole',
  'no-window',
  'no-engine',
  'lowered',
  'lowest',
  'broad',
  'kept',
  'empty',
  'note',
  'surface-note',
  'no-claim',
  'hint',
  'mentioned',
  'absent',
  'pinned',
] as const
export type JudgeFastTurnReason = (typeof JUDGE_FAST_TURN_REASONS)[number]

const METHOD_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.:/_-]{0,63}$/

export const judgeFastTurnDecisionSchema = z.strictObject({
  decision: z.enum(JUDGE_FAST_TURN_DECISIONS),
  /** Evaluations this turn; the entry exists only above zero. */
  evaluated: z.number().check(z.int(), z.minimum(1)),
  /** The condition held at least once (naturally, or forced by the pin). */
  raised: z.boolean(),
  /** The host applied it at least once. */
  acted: z.boolean(),
  reason: z.enum(JUDGE_FAST_TURN_REASONS),
  /** Triage only: results that rode whole for want of a real window. */
  noWindow: z.optional(z.number().check(z.int(), z.minimum(0))),
})
export type JudgeFastTurnDecisionRecord = z.infer<typeof judgeFastTurnDecisionSchema>

export const judgeFastTurnSchema = z.strictObject({
  type: z.literal('judgeFastTurn'),
  turnId: z.string().check(z.minLength(1)),
  backend: z.enum(['modelApi', 'museCode']),
  /** What decided: `deterministic`, or the engine's id when one served. */
  method: z.string().check(z.regex(METHOD_PATTERN)),
  decisions: z.array(judgeFastTurnDecisionSchema).check(z.minLength(1)),
  /** Judge engine calls spent this turn (observed; zero when none ran). */
  judgeCalls: z.number().check(z.int(), z.minimum(0)),
  /** Judge engine tokens spent this turn (observed; zero when none ran). */
  judgeTokens: z.number().check(z.int(), z.minimum(0)),
})
export type JudgeFastTurn = z.infer<typeof judgeFastTurnSchema>
