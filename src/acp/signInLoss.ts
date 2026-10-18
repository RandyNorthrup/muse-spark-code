// F94: the loud failure as the ACP prompt answers it: a turn refused for
// a sign-in its restarted backend lost becomes an `authRequired` error
// naming the restart and the remedy. Anything else is left to the
// caller, which keeps today's path.
import { RequestError } from '@agentclientprotocol/sdk'
import { signInLossText, type SignInLossInput } from '../core/backends/musecode/signInLoss'

/** The loud failure; undefined when this turn is not a post-restart sign-in loss. */
export function signInLossFailure(input: SignInLossInput): RequestError | undefined {
  const text = signInLossText(input)
  return text === undefined ? undefined : RequestError.authRequired(undefined, text)
}
