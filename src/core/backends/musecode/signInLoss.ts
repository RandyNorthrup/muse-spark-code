// F94: a backend that loses its sign-in across a restart says so loudly.
// The replacement host carries why the previous run went away
// (`AgentHost.peekRestartCause`, kept for every auth failure of that
// generation and cleared by `clearRestartCause` once a turn completes);
// every turn that then fails with `authRequired` names that restart and
// the way back instead of failing as just another turn. Anything else
// (no restart behind it, another failure kind) is left to the caller,
// which keeps today's path.
import { AUTH_REQUIRED_ERROR_KIND, UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'

export interface SignInLossInput {
  readonly errorKind: string | undefined
  readonly reason: string | undefined
  /** What `peekRestartCause` gave for this host, if anything. */
  readonly restartCause: string | undefined
}

/**
The loud words for a turn refused for a sign-in its restarted backend
lost, or undefined when this turn is not that: no restart behind it,
or a failure of another kind. The message carries the restart's
cause, the turn's reason and the remedy.
*/
export function signInLossText(input: SignInLossInput): string | undefined {
  if (input.errorKind !== AUTH_REQUIRED_ERROR_KIND || input.restartCause === undefined) {
    return undefined
  }
  return fill(UI_TEXT.museSignInLostOnRestart, {
    exit: input.restartCause,
    detail: input.reason ?? input.errorKind,
  })
}
