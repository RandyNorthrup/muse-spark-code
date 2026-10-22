import { selectTeamEntry } from './selection'
import {
  answerExhausted,
  type TeamSelectionSnapshot,
  type TeamSelection,
  type TeamExhaustedAnswer,
} from './teamPool'
import type { TeamSkip } from '../../shared/teamPreference'
import { TEAM_TASKS_PER_TURN_DEFAULT } from '../../shared/constants'
// The reviewer's pick (M96 lane I, PLAN.md D75): `merge` of a writing task
// is refused until a `code-review` task has reviewed the branch's current
// head. The runner chooses the first entry with headroom whose model
// differs from every model that wrote the change: each entry that worked on
// the branch (through `continue` or continue on next), and the
// orchestrator's model for edits it made itself.
//
// Two models are the same when lane R's `sameModel` says so (injected: the
// registry's model id, whatever provider serves them). An external agent's
// model is the one it reports, or else its vendor: that shaping is lane A /
// lane R data, arriving here as plain model ids. Pure: no git, no `vscode`.

/** A reviewer entry lane A reports: its model and whether it has headroom. */
export interface ReviewCandidate {
  readonly entryId: string
  readonly modelId: string
  readonly hasHeadroom: boolean
}

/** The chosen reviewer: `sameModel` marks the fallback the map shows. */
export interface ReviewPick {
  readonly entryId: string
  readonly modelId: string
  readonly sameModel: boolean
  readonly skips?: readonly TeamSkip[]
}

/** Configured preferences exhausted: the gate must wait or ask, never waive review. */
export interface ReviewUnavailable {
  readonly kind: 'noneEligible'
  readonly roleId: string
  readonly skips: readonly TeamSkip[]
  readonly exhausted: TeamExhaustedAnswer
}

export function pickReviewer(
  authors: readonly string[],
  candidates: readonly ReviewCandidate[],
  isSameModel: (left: string, right: string) => boolean,
): ReviewPick | undefined
export function pickReviewer(
  authors: readonly string[],
  candidates: readonly ReviewCandidate[],
  isSameModel: (left: string, right: string) => boolean,
  live: { readonly snapshot: TeamSelectionSnapshot; selected?(selection: TeamSelection): void },
): ReviewPick | ReviewUnavailable | undefined

/**
The first entry with headroom whose model differs from every author, or
— when every reviewer with headroom shares an author's model — the first
entry with headroom, marked `sameModel`. No reviewer with headroom (or
none staffed) is `undefined`: the merge then goes ahead marked "not
reviewed" (reviewGate.ts). With preferences, exhaustion is explicit and blocks.
*/
export function pickReviewer(
  authors: readonly string[],
  candidates: readonly ReviewCandidate[],
  isSameModel: (left: string, right: string) => boolean,
  live?: { readonly snapshot: TeamSelectionSnapshot; selected?(selection: TeamSelection): void },
): ReviewPick | ReviewUnavailable | undefined {
  const snapshot = live?.snapshot
  if (snapshot?.preference !== undefined) {
    const availability = snapshot.availability
    if (availability === undefined) throw new Error('team:availabilityMissing')
    const pool = {
      roleId: snapshot.preference.role,
      entries: [],
      // Self cannot waive review or authorize an excluded author; ask for an eligible reviewer.
      policy: snapshot.preference.exhausted === 'queue' ? ('queue' as const) : ('ask' as const),
      continueOnNext: false,
    }
    const selection = selectTeamEntry(
      pool,
      {
        ...snapshot,
        conditions: {
          ...snapshot.conditions,
          authorEngines: [...authors, ...(snapshot.conditions?.authorEngines ?? [])],
        },
        availability: {
          probe: (candidate, nowMs) => {
            const live = availability.probe(candidate, nowMs)
            if (!live.available) return live
            const entry = candidates.find((item) => item.entryId === candidate.id)
            let reason: TeamSkip['reason'] | undefined
            if (!entry?.hasHeadroom) reason = 'busy'
            else if (
              !isSameModel(entry.modelId, candidate.agent?.model ?? snapshot.defaultAgent.modelId)
            )
              reason = 'unhealthy'
            else if (authors.some((author) => isSameModel(entry.modelId, author))) reason = 'author'
            return reason === undefined
              ? live
              : { available: false, skip: { candidateId: candidate.id, reason } }
          },
        },
      },
      TEAM_TASKS_PER_TURN_DEFAULT,
    )
    live?.selected?.(selection)
    return selection.kind === 'selected'
      ? {
          entryId: selection.entry.id,
          modelId: selection.agent.modelId,
          sameModel: false,
          skips: selection.skips ?? [],
        }
      : {
          kind: 'noneEligible',
          roleId: pool.roleId,
          skips: selection.kind === 'exhausted' ? (selection.skips ?? []) : [],
          exhausted: answerExhausted(
            pool,
            selection.kind === 'exhausted' ? selection.reasons : [],
            snapshot.nowMs,
          ),
        }
  }
  const ready = candidates.filter((candidate) => candidate.hasHeadroom)
  const other = ready.find((candidate) =>
    authors.every((author) => !isSameModel(candidate.modelId, author)),
  )
  if (other !== undefined) {
    return { entryId: other.entryId, modelId: other.modelId, sameModel: false }
  }
  const first = ready[0]
  return first === undefined
    ? undefined
    : { entryId: first.entryId, modelId: first.modelId, sameModel: true }
}
