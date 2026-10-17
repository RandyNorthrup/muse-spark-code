// Muse Code's captured experimental account/device-code flow (M55). This
// process owns no chat session and is always closed after success, cancel,
// timeout or error. The extension never sends its Model API key to this host.
//
// A sign-in has succeeded (PLAN.md D26, 2026-09-27) when polling
// `account/read` on the same host sees the account sign in, or when the
// credential file is written and `account/read` does not contradict it; a
// CLI that cannot answer `account/read` falls back to the file alone.
//
// `account/loginCompleted` ends the flow on any outcome but `granted`. Every
// outcome was captured live (docs/certification/sign-in-detection.md, "Live
// capture"): `cancelled`, `expired`, `denied` and `failed` each have a
// meaning of their own, and any other word is shown as the CLI named it
// (AGENTS.md rule 13). `granted` came 205 ms after the file was written and
// `account/read` said `accountLogin`, so those usually decide first. It is
// remembered for when they cannot: `granted` with `account/read` saying
// `accountLogin` is the sign-in, with no first `account/read` to compare,
// or when the account was already `accountLogin` (a same-account re-sign-in
// on macOS may change only the Keychain). `granted` alone never signs in. `account/changed` is not relied on: it fired neither
// for a change made outside the host nor for an expired, denied or failed
// code.
//
// Cancel, the host's ending and the host's exit are noticed at once, even
// while an `account/read` is unanswered, and the `account/loginCancel` sent
// on the way out is bounded: the host is closed either way, which ends its
// flow. A host that exits after the credential file changed has signed in,
// unless an answered `account/read` said signed out about that same write:
// that evidence stands for the exit and for a question left unanswered.

import * as z from 'zod/mini'
import { wireWordForLog } from '../../core/logging'
import { withDeadline } from '../../core/timeouts'
import {
  CREDENTIAL_POLL_INTERVAL_MS,
  CREDENTIAL_POLL_TIMEOUT_MS,
  MSP_HANDSHAKE_TIMEOUT_MS,
  MUSE_ACCOUNT_DEVICE_CODE_TYPE,
  MUSE_ACCOUNT_LOGIN_CANCEL,
  MUSE_ACCOUNT_LOGIN_COMPLETED,
  MUSE_ACCOUNT_LOGIN_START,
  MUSE_ACCOUNT_STATES,
  MUSE_DEVICE_SIGN_IN_URL_ORIGIN,
  MUSE_LOGIN_CANCEL_TIMEOUT_MS,
  MUSE_LOGIN_OUTCOME_SHOWN_MAX_CHARS,
  MUSE_LOGIN_OUTCOMES,
} from '../../shared/constants'
import type { Logger } from '../logger'
import { type AccountSession, type AccountState, readAccountState } from './accountHost'

const loginStartSchema = z.object({
  verificationUrl: z.url(),
  userCode: z.string().check(z.minLength(1)),
})
// As captured: `expired` and `denied` carry a message ("login failed: the
// request expired" / "… was denied"), `failed` one that names the credential
// file's path, `cancelled` and `granted` none. The message is free text the
// CLI chose, so neither the log nor the panel shows it: the log names each
// captured ending in fixed words (`loggedEnding`).
const loginCompletedSchema = z.object({
  outcome: z.string().check(z.minLength(1)),
})
const loginCancelSchema = z.object({ cancelled: z.boolean() })

export interface DeviceSignInDeps {
  readonly connect: (signal: AbortSignal) => Promise<AccountSession>
  readonly credentialFileModifiedAt: () => number | undefined
  readonly sleep: (ms: number) => Promise<void>
  readonly now: () => number
  readonly signal: AbortSignal
  readonly onCode: (url: string, code: string) => void
  readonly log: Logger
}

/** An ending Muse Code named that no capture covers: shown as it came (AGENTS.md rule 13). */
export interface DeviceSignInEnded {
  readonly endedAs: string
}
/** The endings captured live, each with a meaning of its own. */
export type CapturedSignInEnding = 'cancelled' | 'expired' | 'denied' | 'failed'
/** How the host ended a flow that did not sign in. */
type HostEnding = CapturedSignInEnding | DeviceSignInEnded
export type DeviceSignInOutcome = 'signedIn' | 'timedOut' | HostEnding

const STOPPED = Symbol('device sign-in stopped')

/**
 * A host that exits mid-flow fails the sign-in at once, instead of being
 * polled until the backstop (the review of PR #49).
 */
function hostGone(): Error {
  return new Error('The Muse Code sign-in host exited during sign-in')
}

// The endings captured live: `cancelled` (1.3.0, M55; 1.4.0-R4302.1),
// `expired` (600 s after `account/loginStart`), `denied` (Deny clicked) and
// `failed` (approved, but the file could not be written), all 1.4.0-R4302.1.
const CAPTURED_ENDINGS: ReadonlyMap<string, CapturedSignInEnding> = new Map([
  [MUSE_LOGIN_OUTCOMES.cancelled, 'cancelled'],
  [MUSE_LOGIN_OUTCOMES.expired, 'expired'],
  [MUSE_LOGIN_OUTCOMES.denied, 'denied'],
  [MUSE_LOGIN_OUTCOMES.failed, 'failed'],
])

// How the log names each captured ending: fixed words, never the CLI's
// message (the review of PR #49). `clipForLog` only shortens, and the
// redactor catches keys, not a path or an e-mail address a message may hold.
const LOGGED_ENDINGS: ReadonlyMap<string, string> = new Map([
  [MUSE_LOGIN_OUTCOMES.granted, 'granted'],
  [MUSE_LOGIN_OUTCOMES.cancelled, 'cancelled'],
  [MUSE_LOGIN_OUTCOMES.expired, 'expired: the code expired before it was approved'],
  [MUSE_LOGIN_OUTCOMES.denied, 'denied: the sign-in was denied in the browser'],
  [MUSE_LOGIN_OUTCOMES.failed, 'failed: saving the credential failed'],
])

/** How the log names an ending: fixed words, or an uncovered word in the shape of one. */
function loggedEnding(outcome: string): string {
  return (
    LOGGED_ENDINGS.get(outcome) ??
    `${wireWordForLog(outcome)} (an ending no capture covers; its message is not logged)`
  )
}

/** How `outcome` ends the flow; undefined for `granted`, which `account/read` bears out. */
function endingOf(outcome: string): HostEnding | undefined {
  if (outcome === MUSE_LOGIN_OUTCOMES.granted) {
    return undefined
  }
  const captured = CAPTURED_ENDINGS.get(outcome)
  if (captured !== undefined) {
    return captured
  }
  const shown =
    outcome.length > MUSE_LOGIN_OUTCOME_SHOWN_MAX_CHARS
      ? `${outcome.slice(0, MUSE_LOGIN_OUTCOME_SHOWN_MAX_CHARS)}…`
      : outcome
  return { endedAs: shown }
}

/**
 * Settles with `value` once `signal` aborts (at once if it already has);
 * `remove` stops listening. Not `Promise.withResolvers`: VS Code 1.99 and
 * 1.100 run Node 20 (PLAN.md M62).
 */
function settleOnAbort<T>(
  signal: AbortSignal,
  value: T,
): { readonly promise: Promise<T>; readonly remove: () => void } {
  const listening = new AbortController()
  const promise = new Promise<T>((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        resolve(value)
      },
      { once: true, signal: listening.signal },
    )
    if (signal.aborted) {
      resolve(value)
    }
  })
  return {
    promise,
    remove: () => {
      listening.abort()
    },
  }
}

/** The returned URL is data from a CLI process: do not open arbitrary origins. */
export function parseDeviceCode(raw: unknown): { readonly url: string; readonly code: string } {
  const parsed = loginStartSchema.parse(raw)
  const url = new URL(parsed.verificationUrl)
  if (url.origin !== MUSE_DEVICE_SIGN_IN_URL_ORIGIN) {
    throw new Error('Muse Code returned an unexpected sign-in URL')
  }
  return { url: url.href, code: parsed.userCode }
}

/** The signals that a new sign-in landed, as one poll sees them. */
interface SignInSignals {
  /** Undefined when the host did not answer the first question. */
  readonly initial: AccountState | undefined
  /** Undefined when the host did not answer, or the poll was cut short. */
  readonly current: AccountState | undefined
  readonly isFileWritten: boolean
  /** The host sent `account/loginCompleted {outcome: "granted"}`. */
  readonly isGranted: boolean
}

function isSignedIn(signals: SignInSignals): boolean {
  const { initial, current, isFileWritten, isGranted } = signals
  if (current === undefined) {
    return isFileWritten
  }
  // A file written by a sign-out. Signed out is signed out, whatever the
  // uncaptured `credentialRequired: false` might mean (the review of PR #49).
  if (current.state === MUSE_ACCOUNT_STATES.loggedOut) {
    return false
  }
  // `envKey` or a stored key may mask the new login, so a new file counts
  // while the account is anything but signed out.
  if (isFileWritten) {
    return true
  }
  const isAccountLogin = current.state === MUSE_ACCOUNT_STATES.accountLogin
  // The host's own `granted`, borne out by `account/read` saying
  // `accountLogin` (the captured success), is a sign-in whatever came
  // before. That matters where no change of state or file can show it: with
  // no first answer, and for a same-account re-sign-in on macOS that
  // replaces only the Keychain item while the logout hold keeps the old
  // sign-in (Codex on 328efb52). Otherwise a sign-in shows as a change from
  // an account read before the flow. `granted` alone never counts.
  const hasChangedToLogin =
    initial !== undefined && initial.state !== MUSE_ACCOUNT_STATES.accountLogin
  return isAccountLogin && (isGranted || hasChangedToLogin)
}

export async function runDeviceSignIn(deps: DeviceSignInDeps): Promise<DeviceSignInOutcome> {
  const isAborted = () => deps.signal.aborted
  if (isAborted()) {
    return 'cancelled'
  }
  const before = deps.credentialFileModifiedAt()
  let session: AccountSession
  try {
    session = await deps.connect(deps.signal)
  } catch (error: unknown) {
    if (isAborted()) {
      return 'cancelled'
    }
    throw error
  }
  // Cancel, the host's own ending, or its exit: whatever the flow is
  // waiting on stops. A controller of the flow's own, not
  // `Promise.withResolvers`, which Node 20 lacks (PLAN.md M62).
  const stopper = new AbortController()
  const stopped = settleOnAbort(stopper.signal, STOPPED)
  const stop = () => {
    stopper.abort()
  }
  let hostEnding: HostEnding | undefined
  let isEnded = false
  let isGranted = false
  let isHostGone = false
  // The file's modification time when an answered `account/read` said
  // signed out: that write (another Muse process's sign-out) is no sign-in,
  // whatever follows it, a host exit or a question left unanswered (the
  // review of PR #49).
  let refutedWrite: number | undefined
  /** A write since the flow began that no answer contradicted. */
  const isFreshWrite = (modified: number | undefined) =>
    modified !== undefined && modified !== before && modified !== refutedWrite
  const isFileWritten = () => isFreshWrite(deps.credentialFileModifiedAt())
  try {
    session.connection.onNotification((notification) => {
      if (isEnded || notification.method !== MUSE_ACCOUNT_LOGIN_COMPLETED) {
        return
      }
      const result = loginCompletedSchema.safeParse(notification.params)
      if (!result.success) {
        return
      }
      // The first ending counts; the host runs one flow.
      isEnded = true
      isGranted = result.data.outcome === MUSE_LOGIN_OUTCOMES.granted
      hostEnding = endingOf(result.data.outcome)
      deps.log.info(`Muse Code sign-in ended: ${loggedEnding(result.data.outcome)}`)
      if (hostEnding !== undefined) {
        stop()
      }
    })
    void session.connection.closed.then(() => {
      isHostGone = true
      stop()
    })
    deps.signal.addEventListener('abort', stop, { once: true })
    if (isAborted()) {
      return 'cancelled'
    }
    /** `work`, or STOPPED as soon as Cancel, the host's ending or its exit arrives. */
    const untilStopped = <T>(work: Promise<T>) => Promise.race([work, stopped.promise])
    /** Why a wait before the polling was cut short; no loginCancel is owed. */
    const stoppedEarly = (): HostEnding => {
      if (hostEnding !== undefined) {
        return hostEnding
      }
      if (isHostGone && !isAborted()) {
        throw hostGone()
      }
      return 'cancelled'
    }
    // The account before the flow, so a sign-in shows as a change.
    const initial = await untilStopped(readAccountState(session.connection))
    if (initial === STOPPED) {
      return stoppedEarly()
    }
    const start = await untilStopped(
      withDeadline(
        session.connection.request(MUSE_ACCOUNT_LOGIN_START, {
          type: MUSE_ACCOUNT_DEVICE_CODE_TYPE,
        }),
        MSP_HANDSHAKE_TIMEOUT_MS,
        'Muse Code did not start sign-in in time',
      ),
    )
    if (start === STOPPED) {
      return stoppedEarly()
    }
    const { url, code } = parseDeviceCode(start)
    deps.onCode(url, code)
    const deadline = deps.now() + CREDENTIAL_POLL_TIMEOUT_MS
    // Captured: the ending arrives before this answer, in milliseconds. A
    // host that does not answer is closed all the same.
    const cancelLogin = async () => {
      try {
        loginCancelSchema.parse(
          await withDeadline(
            session.connection.request(MUSE_ACCOUNT_LOGIN_CANCEL, {}),
            MUSE_LOGIN_CANCEL_TIMEOUT_MS,
            'Muse Code did not cancel sign-in in time',
          ),
        )
      } catch {
        deps.log.warn('Muse Code did not confirm the sign-in cancel; closing its host')
      }
    }
    const hasLanded = async () => {
      // Read before the question, so an answer refutes only a write it saw.
      const modified = deps.credentialFileModifiedAt()
      const current = await untilStopped(readAccountState(session.connection))
      // A stop (Cancel, an ending) decides the flow: a file change alone
      // must not turn it into a sign-in (the review of PR #49).
      if (current === STOPPED) {
        return false
      }
      if (current?.state === MUSE_ACCOUNT_STATES.loggedOut) {
        refutedWrite = modified
      }
      return isSignedIn({ initial, current, isFileWritten: isFreshWrite(modified), isGranted })
    }
    /** How a flow that has not landed ends now; undefined while it goes on. */
    const endedAs = async (): Promise<DeviceSignInOutcome | undefined> => {
      if (hostEnding !== undefined) {
        return hostEnding
      }
      if (isAborted()) {
        await cancelLogin()
        return 'cancelled'
      }
      if (isHostGone) {
        // An exit is no decision: a host that wrote the credential file
        // before it went has signed in, unless an answer already said that
        // write left it signed out (the review of PR #49).
        if (isFileWritten()) {
          deps.log.warn('The Muse Code sign-in host exited after writing the credential file')
          return 'signedIn'
        }
        throw hostGone()
      }
      return undefined
    }
    while (deps.now() < deadline) {
      if (await hasLanded()) {
        return 'signedIn'
      }
      const ending = await endedAs()
      if (ending !== undefined) {
        return ending
      }
      await untilStopped(deps.sleep(CREDENTIAL_POLL_INTERVAL_MS))
    }
    if (await hasLanded()) {
      return 'signedIn'
    }
    const ending = await endedAs()
    if (ending !== undefined) {
      return ending
    }
    await cancelLogin()
    return isAborted() ? 'cancelled' : 'timedOut'
  } finally {
    deps.signal.removeEventListener('abort', stop)
    stopped.remove()
    await session.close()
  }
}
