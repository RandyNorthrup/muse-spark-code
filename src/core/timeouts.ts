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
