// M125 lane M (D107): the fast path's application layer. The reflex
// checks (lane R) name patterns; this module turns their verdicts into
// the bytes the backends send: tail notes, a lowered effort, triage
// routing and keep-lists. Pure and synchronous; the backends hold the
// session state and call it at the design's points. When every verdict
// abstains, every function returns today's bytes unchanged.
//
// Only the deterministic layer routes here. A model-backed question
// needs a fitted profile for the engine's identity (D107 §7.0, lane L)
// and an engine the resolver (lane E) finds eligible for the decision's
// class; no profile is fitted and no machine measured an I engine, so
// every miss below falls back to today's behaviour, byte for byte, and
// names why the engine was not asked for the Judge section (lane U).
import { FAST_PATH_MODEL_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import type { FastWindow } from './classes'
import type { LoopPattern } from './reflex/loop'
import { rankRelevance, type RelevanceCandidate } from './reflex/relevance'
import type { TriageVerdict } from './reflex/triage'

/** One harness note for the request's tail; each backend maps it to its own item shape. */
export interface FastTailNote {
  readonly role: 'developer'
  readonly text: string
}

/** The verdicts' texts as tail notes, in order; empty when nothing fired. */
export function tailNotes(texts: readonly string[]): FastTailNote[] {
  return texts.map((text) => ({ role: 'developer', text }))
}

/** The loop note for the pattern the stream shows (D107 §6.3). */
export function loopTailNote(pattern: LoopPattern, tool: string): string {
  const notes: Record<LoopPattern, string> = {
    repeat: fill(FAST_PATH_MODEL_TEXT.fastLoopRepeat, { tool }),
    oscillation: FAST_PATH_MODEL_TEXT.fastLoopOscillation,
    'same-failure': FAST_PATH_MODEL_TEXT.fastLoopSameFailure,
  }
  return notes[pattern]
}

/** The done note: the request's checks already passed (D107 §6.4). */
export function doneTailNote(): string {
  return FAST_PATH_MODEL_TEXT.fastDoneBacked
}

/** The next turn's hint: a failure the reply leaves unmentioned (D107 §7.3). */
export function failureTailHint(tool: string): string {
  return fill(FAST_PATH_MODEL_TEXT.fastFailureHint, { tool })
}

/** The lead over context the judge ranked for the new message (D107 §6.1). */
export function contextLead(): string {
  return FAST_PATH_MODEL_TEXT.fastContextLead
}

/**
The level below the configured one on the model's own scale (D107
§6.6): the judge may lower effort, never raise it. The configured
level when it is already the lowest or not on the scale, so an
abstention sends today's bytes.
*/
export function lowerEffortLevel(current: string, levels: readonly string[]): string {
  const at = levels.indexOf(current)
  return at <= 0 ? current : (levels[at - 1] ?? current)
}

export type TriageRoute =
  | { readonly action: 'pack' }
  | { readonly action: 'whole'; readonly unasked: 'recognised' | 'no-engine' | 'no-window' }

/**
Route one tool result before its first send (D107 §6.2). A blank
success packs through M73's own sticky placeholder; a recognised
failure rides whole, as does every miss — with the reason the engine
was not asked. The engine question needs an I-eligible engine for any
output, else a real S window; neither holds anywhere measured, so the
miss path is whole-as-today with its reason recorded.
*/
export function triageRoute(
  verdict: TriageVerdict,
  window: FastWindow,
  hasInlineEngine: boolean,
): TriageRoute {
  if (verdict.decision === 'skip') return { action: 'pack' }
  if (verdict.decision === 'needs-full') return { action: 'whole', unasked: 'recognised' }
  const unasked = hasInlineEngine || window === 'real' ? 'no-engine' : 'no-window'
  return { action: 'whole', unasked }
}

/**
The candidates' ids in relevance order (D107 §6.1), for what the new
message appends and what a compaction keeps. Empty on a miss: the
caller then appends and keeps exactly as today.
*/
export function rankedKeepIds(
  query: string,
  candidates: readonly RelevanceCandidate[],
): readonly string[] {
  const verdict = rankRelevance(query, candidates)
  return verdict.decision === 'miss' ? [] : verdict.ranked.map((entry) => entry.id)
}
