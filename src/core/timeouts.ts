// A deadline for a promise that has none of its own (PLAN.md D25): the MSP
// handshake and commands, which the SDK waits on for ever. And an end to the
// wait when the caller stops caring (Cancel, sign-out, the window closing).

import {
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
  STILL_WAITING_NOTICE_MS,
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
 * `promise`, or a `DeadlineError` with `message` once `timeoutMs` has passed.
 * The timer is always cleared; the promise itself keeps running (the caller
 * decides whether to kill what it was waiting on).
 */
export async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new DeadlineError(message))
    }, timeoutMs)
  })
  try {
    return await Promise.race([promise, expired])
  } finally {
    clearTimeout(timer)
  }
}

/** A deadline that a start still under way may stretch once (`withSlowDeadline`). */
interface SlowDeadline {
  readonly firstMs: number
  /** The whole wait, the first deadline's included; never shorter than it. */
  readonly totalMs: number
  /** Whether the work still goes on at the first deadline (its process has not exited). */
  readonly isRunning: () => boolean
  /** The failure's text for the deadline that passed. */
  readonly message: (timeoutMs: number) => string
  /** Told when the first deadline passed and the wait goes on. */
  readonly onSlow: () => void
}

/**
 * `promise` within `firstMs`; past that, while the work still goes on,
 * within `totalMs` in all: one longer wait, so a slow start on a starved
 * machine is not taken for a stuck one, and a stuck one still ends. Work
 * that stopped fails at the first deadline, and a rejection of `promise`
 * (the process died) ends the wait at once.
 */
export async function withSlowDeadline<T>(promise: Promise<T>, deadline: SlowDeadline): Promise<T> {
  try {
    return await withDeadline(promise, deadline.firstMs, deadline.message(deadline.firstMs))
  } catch (error: unknown) {
    if (
      !(error instanceof DeadlineError) ||
      deadline.totalMs <= deadline.firstMs ||
      !deadline.isRunning()
    ) {
      throw error
    }
  }
  deadline.onSlow()
  return await withDeadline(
    promise,
    deadline.totalMs - deadline.firstMs,
    deadline.message(deadline.totalMs),
  )
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

/** The person's words for a wait with no deadline: what waits, and how long. */
export function stillWaitingText(what: string, elapsedMs: number): string {
  const minutes = Math.max(1, Math.round(elapsedMs / MILLISECONDS_PER_SECOND / SECONDS_PER_MINUTE))
  return fill(UI_TEXT.stillWaitingNotice, { what, duration: formatUnit(minutes, 'minute') })
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
