// M125 lane 0 (D107): the fast judge's contract. Decision ids, timing
// classes, deadlines, fallbacks, and the one eligibility function the
// resolver, the recommender, the Done screen and the Judge section share.
// Deadlines select a fallback, never stop work: a decision that misses
// its deadline runs today's behaviour, and the approval reviewer starts
// beside the fast path as today, so a veto or a missing answer adds no
// wait. No `vscode` import.
import {
  JUDGE_FAST_BOUNDARY_DEADLINE_MS,
  JUDGE_FAST_INLINE_DEADLINE_MS,
  JUDGE_FAST_SLACK_DEADLINE_MS,
} from '../../../shared/constants'

/** The fast judge's timing classes (D107): inline, slack, boundary, post-turn. */
export const FAST_TIMING_CLASSES = ['I', 'S', 'B', 'P'] as const
export type FastTimingClass = (typeof FAST_TIMING_CLASSES)[number]

/**
The decisions the fast judge makes. The nine M125 families (lane L) plus
M98's two fitted families, which keep their 2b guarantees.
*/
export const FAST_DECISIONS = [
  'triage.needFull',
  'context.include',
  'loop.stuck',
  'effort.lower',
  'skill.fit',
  'edit.misfit',
  'failure.unmentioned',
  'scope.outside',
  'claim.inconsistent',
  'risk.destructive',
  'done.unbacked',
] as const
export type FastDecisionId = (typeof FAST_DECISIONS)[number]

/**
Each decision's class. Triage answers before the first send; context,
loop, effort and skill route inside a real slack window; the accuracy
checks on the agent's own work surface at the next boundary; the
unbacked-"done" verdict settles post-turn as a note.
*/
export const FAST_DECISION_CLASS: Readonly<Record<FastDecisionId, FastTimingClass>> = {
  'triage.needFull': 'I',
  'context.include': 'S',
  'loop.stuck': 'S',
  'effort.lower': 'S',
  'skill.fit': 'S',
  'edit.misfit': 'B',
  'failure.unmentioned': 'B',
  'scope.outside': 'B',
  'claim.inconsistent': 'B',
  'risk.destructive': 'B',
  'done.unbacked': 'P',
}

/**
What runs when a decision abstains or misses its deadline. Triage falls
back to sending the whole output as today; every other decision falls
back to today's behaviour byte for byte.
*/
export const FAST_DECISION_FALLBACK: Readonly<Record<FastDecisionId, 'whole-output' | 'today'>> = {
  'triage.needFull': 'whole-output',
  'context.include': 'today',
  'loop.stuck': 'today',
  'effort.lower': 'today',
  'skill.fit': 'today',
  'edit.misfit': 'today',
  'failure.unmentioned': 'today',
  'scope.outside': 'today',
  'claim.inconsistent': 'today',
  'risk.destructive': 'today',
  'done.unbacked': 'today',
}

/** Whether the decision runs inside a real slack window (D107's S rule). */
export type FastWindow = 'real' | 'none'

const FAST_DEADLINE_MS: Readonly<Record<FastTimingClass, number | undefined>> = {
  I: JUDGE_FAST_INLINE_DEADLINE_MS,
  S: JUDGE_FAST_SLACK_DEADLINE_MS,
  B: JUDGE_FAST_BOUNDARY_DEADLINE_MS,
  P: undefined,
}

/** A class's deadline in milliseconds; post-turn has none. */
export function fastDeadlineMs(timingClass: FastTimingClass): number | undefined {
  return FAST_DEADLINE_MS[timingClass]
}

/**
The one eligibility rule (D107): an engine serves a class only when its
rolling complete-call p95 fits the class's deadline — for a local
engine 2j's verified path, never raw inference. Slack additionally
needs a real window; a lone result has none, so first-send triage of
it uses the deterministic parser or an I engine. A miss (infinite
latency) fits no deadline class. Suspension is the resolver's job, not
eligibility's, so post-turn admits every engine.
*/
// eslint-disable-next-line unicorn/consistent-boolean-name -- M125 lane 0 names this function `eligible(class, p95, window)` in PLAN; the resolver, recommender, Done screen and Judge section share the one name.
export function eligible(timingClass: FastTimingClass, p95Ms: number, window: FastWindow): boolean {
  if (timingClass === 'P') return true
  if (!Number.isFinite(p95Ms)) return false
  const deadline = fastDeadlineMs(timingClass)
  return deadline !== undefined && p95Ms <= deadline && (timingClass !== 'S' || window === 'real')
}
