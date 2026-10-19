// A deadline for a promise that has none of its own (PLAN.md D25): the MSP
// handshake and commands, which the SDK waits on for ever. And an end to the
// wait when the caller stops caring (Cancel, sign-out, the window closing).

import {
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
  STILL_WAITING_NOTICE_MS,
  TIMER_MAX_DELAY_MS,
  UI_TEXT,
} from '../shared/constants'
import { fill, formatUnit } from '../shared/l10n/text'

export class DeadlineError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'DeadlineError'
  }
}

/**
 * Runs `callback` once `delayMs` has passed, however long: a delay past
 * `TIMER_MAX_DELAY_MS` would fire after 1 ms on one timer, so it runs as a
 * chain of timer-sized pieces. The returned function cancels it.
 */
export function setLongTimeout(callback: () => void, delayMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = (leftMs: number): void => {
    const pieceMs = Math.min(leftMs, TIMER_MAX_DELAY_MS)
    timer = setTimeout(() => {
      if (leftMs > pieceMs) arm(leftMs - pieceMs)
      else callback()
    }, pieceMs)
  }
  arm(delayMs)
  return () => {
    clearTimeout(timer)
  }
}

/**
 * `promise`, or a `DeadlineError` with `message` once `timeoutMs` has passed.
 * The timer is always cleared; the promise itself keeps running (the caller
 * decides whether to kill what it was waiting on).
 */
export async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let cancel: (() => void) | undefined
  const expired = new Promise<never>((_resolve, reject) => {
    cancel = setLongTimeout(() => {
      reject(new DeadlineError(message))
    }, timeoutMs)
  })
  try {
    return await Promise.race([promise, expired])
  } finally {
    cancel?.()
  }
}

/**
 * An answer with no deadline of its own (owner 2026-10-16: no arbitrary
 * limits): `answer` until it settles, saying so out loud through `tell`
 * every `everyMs` meanwhile (a notice cadence, not a limit). The wait
 * itself ends only at the answer or at Stop (`signal` aborts: dispose, a
 * newer attempt, the window closing), which throws `stopError`. Tests name
 * short waits through `everyMs`.
 */
export async function waitForAnswer<T>(
  answer: Promise<T>,
  signal: AbortSignal,
  stopError: () => Error,
  tell: (elapsedMs: number) => void,
  everyMs: number = STILL_WAITING_NOTICE_MS,
): Promise<T> {
  if (signal.aborted) throw stopError()
  let onAbort: (() => void) | undefined
  const stopped = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(stopError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  const stopNoticing = startStillWaiting(tell, everyMs)
  try {
    return await Promise.race([answer, stopped])
  } finally {
    stopNoticing()
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  }
}

/**
 * A wait with no deadline of its own says so out loud (owner 2026-10-16:
 * no silent hangs): `tell` runs with the elapsed milliseconds every
 * `everyMs` until the returned stop runs. The work itself keeps waiting;
 * only its own end or Stop ends it. A notice cadence, not a limit.
 */
export function startStillWaiting(
  tell: (elapsedMs: number) => void,
  everyMs: number = STILL_WAITING_NOTICE_MS,
): () => void {
  const startedAt = Date.now()
  const timer = setInterval(() => {
    tell(Date.now() - startedAt)
  }, everyMs)
  return () => {
    clearInterval(timer)
  }
}

/**
 * What a still-waiting notice names (PR #214 review): a key into the
 * translated subject table, never English prose, so a non-English locale
 * reads the whole notice in its own language. Names the other side chose
 * (a server, a method) travel as slots.
 */
export type StillWaitingSubject =
  | { readonly key: 'imageRequest' }
  | { readonly key: 'providerAnswer' }
  | { readonly key: 'modelReply' }
  | { readonly key: 'mcpServerStartup'; readonly name: string }
  | { readonly key: 'mcpServerRequest'; readonly name: string; readonly method: string }
  | { readonly key: 'museCodeCommand'; readonly method: string }
  | { readonly key: 'sessionDeletion' }
  | { readonly key: 'shellCommand' }
  | { readonly key: 'museServeStarting' }
  | { readonly key: 'webFetch' }

/**
 * A notice's subject in the installed language. The subject itself carries
 * the slots its template names (`fill` leaves the rest alone), so every
 * key of the union is read and none needs its own branch.
 */
export function stillWaitingSubjectText(subject: StillWaitingSubject): string {
  return fill(UI_TEXT.stillWaitingSubject[subject.key], subject)
}

/** The person's words for a wait with no deadline: what waits, and how long. */
export function stillWaitingText(subject: StillWaitingSubject, elapsedMs: number): string {
  const minutes = Math.max(1, Math.round(elapsedMs / MILLISECONDS_PER_SECOND / SECONDS_PER_MINUTE))
  return fill(UI_TEXT.stillWaitingNotice, {
    what: stillWaitingSubjectText(subject),
    duration: formatUnit(minutes, 'minute'),
  })
}

/** Does nothing: the abort listener until it is made, and a late failure nobody waits for. */
const IGNORE = (): void => undefined

/**
 * `work`'s value, or undefined as soon as `signal` aborts. `work` runs on
 * (a probe's answer is still cached); its failure after the abort is
 * handled by the race.
 */
export async function unlessAborted<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T | undefined> {
  if (signal.aborted) {
    // Nobody waits for it now: a late failure is nobody's to report.
    void work.catch(IGNORE)
    return undefined
  }
  let onAbort = IGNORE
  const aborted = new Promise<undefined>((resolve) => {
    onAbort = () => {
      resolve(undefined)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([work, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}
