// The one team availability rule (PLAN.md D217, owner 2026-10-23): every
// surface offers teams only while the person has at least two usable models
// configured — a lead plus at least one worker the team engine can really
// dispatch to — and the person has not switched teams off. A candidate
// counts only when it names a different model than the lead (through the
// caller's same-model comparison), is available to dispatch to, and, when
// it bills a key, the paid team-workers gate is on. Probes are not read
// here: a surface without probe results counts configured, dispatchable
// models, and the conversation check adds readiness on top.
//
// Shared by host and webview: no `vscode`, Node, or DOM imports.

import { UI_TEXT } from './constants'

/**
Lane R's `sameModel` for callers that cannot import core (activation
carries no team runtime module): two model ids name the same model when
they match after trimming, whatever provider or backend serves them.
Kept identical to `isSameTeamModel` by the equivalence test in
teamAvailability.test.ts.
*/
export function isSameTeamModelId(a: string, b: string): boolean {
  return a.trim() === b.trim()
}

/** One worker candidate as the availability rule sees it. */
export interface TeamAvailabilityCandidate {
  /** The model id M95's registry gives it, whatever serves it. */
  readonly modelId: string
  /** Billed to a key: needs the paid team-workers gate on. */
  readonly billsKey: boolean
  /** Installed, signed in, its key present, its provider reachable. */
  readonly isAvailable: boolean
}

export interface TeamAvailabilityInput {
  /** The person explicitly switched teams off. */
  readonly isSwitchedOff: boolean
  /** The lead's model id (the conversation, session or run model). */
  readonly leadModelId: string
  /** Every worker candidate across backends and providers. */
  readonly candidates: readonly TeamAvailabilityCandidate[]
  /** Lane R's `sameModel`: model ids compared whatever serves them. */
  readonly isSameModel: (a: string, b: string) => boolean
  /** Lane A's paid `teamWorkers`: key-billed tasks ask the D48 popup. */
  readonly teamWorkersOn: boolean
}

/** Why teams are offered, or not. */
export type TeamAvailabilityReason = 'ready' | 'switched-off' | 'needs-second-model'

export interface TeamAvailability {
  readonly isAvailable: boolean
  readonly reason: TeamAvailabilityReason
  /** Distinct usable models the engine can dispatch to, lead included. */
  readonly usableModels: number
}

/**
The sets the rule reads: candidates distinct from the lead, and the
runnable ones among them (available, and key-billed only while the paid
gate is on). Generic so callers keep their own entry shape.
*/
export function partitionTeamCandidates<Candidate extends TeamAvailabilityCandidate>(
  candidates: readonly Candidate[],
  options: {
    readonly leadModelId: string
    readonly isSameModel: (a: string, b: string) => boolean
    readonly teamWorkersOn: boolean
  },
): { readonly distinct: readonly Candidate[]; readonly runnable: readonly Candidate[] } {
  const distinct = candidates.filter(
    (entry) => !options.isSameModel(entry.modelId, options.leadModelId),
  )
  const runnable = distinct.filter(
    (entry) => entry.isAvailable && (!entry.billsKey || options.teamWorkersOn),
  )
  return { distinct, runnable }
}

/**
Whether teams are offered: the person has not switched them off and at
least one worker candidate is runnable beside the lead.
*/
export function checkTeamAvailability(input: TeamAvailabilityInput): TeamAvailability {
  const { runnable } = partitionTeamCandidates(input.candidates, input)
  const usableModels = 1 + runnable.length
  if (input.isSwitchedOff) return { isAvailable: false, reason: 'switched-off', usableModels }
  return runnable.length === 0
    ? { isAvailable: false, reason: 'needs-second-model', usableModels }
    : { isAvailable: true, reason: 'ready', usableModels }
}

/**
The words an entry point refuses with while teams are unavailable, or
undefined while they are offered. Read at call time, so the installed
language is the one shown.
*/
export function teamAvailabilityRefusal(
  availability: Pick<TeamAvailability, 'isAvailable' | 'reason'>,
): string | undefined {
  if (availability.isAvailable) return undefined
  const reason = availability.reason
  return reason === 'switched-off' ? UI_TEXT.teamSwitchedOff : UI_TEXT.teamNeedsSecondModel
}
