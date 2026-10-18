// The host's side of the panel-focus drop rule (PLAN.md D116, the review's
// F3): the host owns every focus request it sends, and delivers one only
// while its panel is the active one. Pure decisions over injected values, so
// they are unit-tested without VS Code; `configureWebview` (webviewSetup.ts)
// is the single gate every sender's `focusInput` passes through.

import { FOCUS_REQUEST_WINDOW_MS } from '../../shared/constants'

/**
Whether the host delivers a `focusInput` now instead of dropping it. True
while the target panel is the active one, or while the reveal the person
just asked for still propagates (its focus arrives within the delivery
window after `reveal()`). Anything else is dropped, never held: a stale
request must not land on a much later click.
*/
export function shouldDeliverFocusInput(
  isActive: boolean,
  revealedAt: number | undefined,
  now: number,
): boolean {
  return isActive || (revealedAt !== undefined && now - revealedAt <= FOCUS_REQUEST_WINDOW_MS)
}

/** The host-owned token a delivered `focusInput` carries, with its issue time. */
export function mintFocusRequest(
  now: number,
  newToken: () => string,
): { readonly token: string; readonly issuedAt: number } {
  return { token: newToken(), issuedAt: now }
}
