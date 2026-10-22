import { MachineError } from '../registry'

/** Bound a driver even if it ignores cancellation; no late success settles the caller. */
export async function withMakerDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new MachineError('machineDeadline'))
    }, timeoutMs)
  })
  try {
    return await Promise.race([work(controller.signal), expiry])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
