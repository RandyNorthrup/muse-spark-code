// The words for a failed turn the CLI judged resubmittable
// (TurnError.retryable, RLWINFIX2 item 3): one sentence the ACP agent and
// the panel share, so a transient service failure reads the same
// everywhere. Only the CLI's retryable judgment branches here: its kinds
// stay open, and its reason and message are never branched on (the
// schema forbids it) — the reason rides along as a technical detail, as
// it already does on every failed turn.
//
// Beside it, the words for a spent subscription window (PLAN.md D252):
// one failure sentence and one wait-row sentence the panel, the ACP
// agent and headless exec share, each with the reset in the person's
// local time. Only the typed quota detail's presence branches here;
// the CLI's kinds, reason and message stay unbranched.
import { UI_TEXT } from './constants'
import { fill, formatDateTime } from './l10n/text'

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

/**
What a quota-exhausted turn says: our sentence with the provider's reset
instant in the person's local time. Anything without the typed detail
answers undefined and keeps its existing words.
*/
export function quotaTurnFailureText(event: {
  readonly quota?: { readonly resetsAtMs: number } | undefined
}): string | undefined {
  if (event.quota === undefined) return undefined
  return fill(UI_TEXT.subscriptionQuotaExhausted, {
    resetTime: formatDateTime(event.quota.resetsAtMs),
  })
}

/** What the opt-in wait until the window resets says on the panel's row. */
export function quotaWaitText(quota: { readonly resetsAtMs: number }): string {
  return fill(UI_TEXT.turnQuotaWaiting, { resetTime: formatDateTime(quota.resetsAtMs) })
}
