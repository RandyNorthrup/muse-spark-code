// Turns that pause and resume across a dropped model connection (M110r Y1,
// PLAN.md D90.25). A network failure pauses a turn; it never fails it. The
// turn retries inside the request's own bounds (the transport's, from the
// provider's documented limits and the person's setting), then stays
// paused, resumable, until the network returns or the person acts. No
// count of ours stops it (D121): attempt numbers are facts shown, and "of
// N" appears only when the person set a cap or the provider documents one.
// Pure; the transports and hosts below call in.

import { CONNECTION_ERROR_CODES, TLS_TRUST_ERROR_CODES, UI_TEXT } from '../../shared/constants'
import { fill, formatDateTime } from '../../shared/l10n/text'
import { connectionFailureCodes, failureCodeNames } from '../networkFailure'

/** What a turn-ending failure means for the turn: wait, or stop. */
export type TurnInterruptionClass = 'network' | 'fatal'

/**
A turn-ending failure, classified. `isProvedBeforeSend` is true only when
every code in the failure's causes proves the request never left: DNS, a
refused connection, or a TLS handshake the peer never completed. Anything
else (a reset mid-stream, a cut socket, a failure with no codes at all) may
have reached the provider, so consent and accounting treat it as sent.
*/
export interface TurnInterruption {
  readonly class: TurnInterruptionClass
  readonly isProvedBeforeSend: boolean
  /** Code names only, safe for logs and sentences. */
  readonly codes: string
}

/**
Codes that prove the request never left (DNS, connect, TLS handshake), as
Node 24 throws them (the sets M56 captured, docs/certification/m56.md). A
mid-stream `ECONNRESET`, `ETIMEDOUT` or `UND_ERR_SOCKET` is absent on
purpose: the send may have arrived.
*/
const BEFORE_SEND_CODES: ReadonlySet<string> = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  ...TLS_TRUST_ERROR_CODES,
])

/**
The codes that pause a turn: M56's connection and TLS sets. Any other
code (`ENOENT` for a missing CLI, a product refusal) or none at all is
fatal to the turn: pausing would wait on something the network's return
cannot fix. Callers check cancellation first: a stop is neither.
*/
function unionOf(...sets: readonly ReadonlySet<string>[]): ReadonlySet<string> {
  const out = new Set<string>()
  for (const set of sets) {
    for (const code of set) out.add(code)
  }
  return out
}

const NETWORK_CODES: ReadonlySet<string> = unionOf(CONNECTION_ERROR_CODES, TLS_TRUST_ERROR_CODES)

/**
Classify a turn-ending failure. A failure naming a network code in its
causes (fetch, the CLI's stdio transport, TLS) pauses the turn;
anything else is fatal to it.
*/
export function classifyTurnInterruption(error: unknown): TurnInterruption {
  const codes = connectionFailureCodes(error)
  const isProvedBeforeSend = codes.length > 0 && codes.every((code) => BEFORE_SEND_CODES.has(code))
  return {
    class: codes.some((code) => NETWORK_CODES.has(code)) ? 'network' : 'fatal',
    isProvedBeforeSend,
    codes: failureCodeNames(error),
  }
}

/**
Whether a D48 paid feature retried after `interruption` asks consent
again: always, unless the failure is proved to have happened before the
request was sent.
*/
export function shouldReaskConsent(interruption: TurnInterruption): boolean {
  return !interruption.isProvedBeforeSend
}

/** A paused turn: what the row shows and what the resume carries. */
export interface TurnPause {
  readonly attemptId: string
  readonly pausedAt: number
  /** True when the cut attempt may have executed provider-side. */
  readonly sentUnknown: boolean
  readonly codes: string
  readonly priorAttemptId: string | undefined
}

/** Pause `attemptId` on a network interruption; fatal ones never pause. */
export function pauseTurn(
  attemptId: string,
  interruption: TurnInterruption,
  now: number,
  priorAttemptId?: string,
): TurnPause | undefined {
  if (interruption.class !== 'network') return undefined
  return {
    attemptId,
    pausedAt: now,
    sentUnknown: !interruption.isProvedBeforeSend,
    codes: interruption.codes,
    priorAttemptId: priorAttemptId,
  }
}

/** The journal link between a paused attempt and its resume. */
export interface AttemptLink {
  readonly previousAttemptId: string
  readonly nextAttemptId: string
  readonly reason: 'network-resume'
}

/** Link the resume attempt to the pause it continues. */
export function linkResumeAttempt(pause: TurnPause, nextAttemptId: string): AttemptLink {
  return { previousAttemptId: pause.attemptId, nextAttemptId, reason: 'network-resume' }
}

/**
The paused row's sentence, read when shown (D33). The attempt count is a
fact; the cap appears only when one exists (the person's setting or the
provider's documented maximum).
*/
export function pausedTurnText(pause: TurnPause, attempt: number, cap?: number): string {
  const time = formatDateTime(pause.pausedAt)
  if (cap === undefined) {
    return fill(UI_TEXT.turnPausedNetwork, { time, attempt: String(attempt) })
  }
  return fill(UI_TEXT.turnPausedNetworkCapped, {
    time,
    attempt: String(attempt),
    cap: String(cap),
  })
}

/**
Whether an exec transport outcome means the connection was lost (Y1's
headless clause: exit incomplete with the session to resume, never
failed). Only `error` qualifies: `aborted` is a stop, `tooLarge` and
`malformed` are refusals of the answer itself.
*/
export function isIncompleteTransportError(transportError: string | null | undefined): boolean {
  return transportError === 'error'
}
