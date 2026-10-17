// A deadline for a promise that has none of its own (PLAN.md D25): the MSP
// handshake and commands, which the SDK waits on for ever. And an end to the
// wait when the caller stops caring (Cancel, sign-out, the window closing).

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
