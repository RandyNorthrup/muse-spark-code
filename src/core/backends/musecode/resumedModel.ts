/**
 * What a resumed Muse Code session runs on (PLAN.md D25, restart recovery).
 *
 * `session/resume` takes no model: a turn carries none either, so the turn
 * runs on whatever standing model the fresh `muse serve` holds for the
 * session, which need not be the one the person chose. Every resume path
 * therefore applies the person's choice with `session/setModel` and reads
 * the CLI's answer back with `model/list` (the row flagged `isActive`)
 * before the next turn is sent. This table decides the outcome from those
 * two values alone: the panel, the log and the editor protocol show the
 * reported model, never the assumed one, and a mismatch sends no turn.
 */
export interface ResumedModelCheck {
  /** The model the person chose for this conversation. */
  readonly wantedModelId: string
  /** The model the CLI reports active for the resumed session, if any. */
  readonly activeModelId: string | undefined
}

export type ResumedModelOutcome =
  | { readonly ok: true; readonly modelId: string }
  | { readonly ok: false; readonly wantedModelId: string; readonly activeModelId: string }

export function resolveResumedModel(check: ResumedModelCheck): ResumedModelOutcome {
  if (check.activeModelId === undefined || check.activeModelId === check.wantedModelId) {
    return { ok: true, modelId: check.wantedModelId }
  }
  return {
    ok: false,
    wantedModelId: check.wantedModelId,
    activeModelId: check.activeModelId,
  }
}
