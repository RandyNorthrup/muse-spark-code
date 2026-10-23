// F94: the loud failure as the ACP prompt answers it: a turn refused for
// a sign-in its restarted backend lost becomes an `authRequired` error
// naming the restart and the remedy. Anything else is left to the
// caller, which keeps today's path. A lost sign-in is never cleared by
// resubmitting, so the error carries `retryable: false` (RLF-ACPTURNS).
import { RequestError } from '@agentclientprotocol/sdk'
import { signInLossText, type SignInLossInput } from '../core/backends/musecode/signInLoss'

/** The loud failure; undefined when this turn is not a post-restart sign-in loss. */
export function signInLossFailure(input: SignInLossInput): RequestError | undefined {
  const text = signInLossText(input)
  return text === undefined ? undefined : RequestError.authRequired({ retryable: false }, text)
}
