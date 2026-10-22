// The words for a failed turn the CLI judged resubmittable
// (TurnError.retryable, RLWINFIX2 item 3): one sentence the ACP agent and
// the panel share, so a transient service failure reads the same
// everywhere. Only the CLI's retryable judgment branches here: its kinds
// stay open, and its reason and message are never branched on (the
// schema forbids it) — the reason rides along as a technical detail, as
// it already does on every failed turn.
import { UI_TEXT } from './constants'

/**
What a retryable failed turn says: our sentence, with the turn's own
reason in parentheses where it carried one. Anything not retryable
answers undefined and keeps its existing words.
*/
export function transientTurnFailureText(event: {
  readonly reason?: string | undefined
  readonly retryable?: boolean | undefined
}): string | undefined {
  if (event.retryable !== true) return undefined
  return event.reason === undefined
    ? UI_TEXT.turnTransientFailed
    : `${UI_TEXT.turnTransientFailed} (${event.reason})`
}
