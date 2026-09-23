// A deadline for a promise that has none of its own (PLAN.md D25): the MSP
// handshake and commands, which the SDK waits on for ever.

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
