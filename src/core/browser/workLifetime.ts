// A bounded, cancellable piece of work (M81 A1, design spec v4 §§4.1, 6.3):
// the runtime's preparation (15 minutes) and the check itself (60 seconds)
// are two separate instances, never one deadline spanning both. The first
// end wins (the deadline, any joined signal, or `end()`), aborts the signal
// every step sees, rejects every step still waiting at that moment, and runs
// the registered cleanups once, newest first, within their own bound. A
// step started after the end is refused; a step whose answer arrives after
// the end has what it returned closed, or disposed by its step, so a late
// download, verification or consent can start nothing.

import type { WorkLifetime } from './runtimeTypes'

/** Why a lifetime ended: its deadline, a joined signal, or its owner. */
export type LifetimeEnd = 'deadline' | 'aborted' | 'ended'

/** A step refused because its lifetime had ended. */
export class LifetimeEndedError extends Error {
  public constructor(public readonly end: LifetimeEnd) {
    super(`the work has ended (${end})`)
    this.name = 'LifetimeEndedError'
  }
}

export interface BoundedLifetime extends WorkLifetime {
  /** How it ended; undefined while it runs. */
  readonly endedBy: LifetimeEnd | undefined
  /** Settles once every cleanup ran or the cleanup bound passed. */
  readonly cleaned: Promise<void>
}

function hasClose(value: unknown): value is { close: () => unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'close' in value &&
    typeof value.close === 'function'
  )
}

/** Runs `work`; its own failure ends nothing further. */
async function quietly(work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch {
    // A cleanup, or a late answer's close, failing changes nothing.
  }
}

// What a step's race sees when the lifetime ended first.
const ENDED = Symbol('ended')

/**
 * A lifetime of `ms` from now, ended early by any of `signals`. Cleanups get
 * `cleanupMs` in all; one that hangs is left behind, not waited for.
 */
export function createLifetime(
  ms: number,
  signals: readonly AbortSignal[],
  cleanupMs: number,
  now: () => number = () => performance.now(),
): BoundedLifetime {
  const controller = new AbortController()
  const ended = new Promise<typeof ENDED>((resolve) => {
    controller.signal.addEventListener('abort', () => {
      resolve(ENDED)
    })
  })
  const cleanups: (() => Promise<void>)[] = []
  let endedBy: LifetimeEnd | undefined
  // Read through a call: an await between two reads may see it change.
  const endOf = (): LifetimeEnd | undefined => endedBy
  // Once it ends, every cleanup, newest first, within `cleanupMs` in all.
  const cleaned = (async (): Promise<void> => {
    await ended
    let timer: ReturnType<typeof setTimeout> | undefined
    const bound = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, cleanupMs)
    })
    const all = (async (): Promise<void> => {
      for (const cleanup of cleanups.toReversed()) {
        await quietly(cleanup)
      }
    })()
    await Promise.race([all, bound])
    clearTimeout(timer)
  })()
  const finish = (why: LifetimeEnd): void => {
    if (endedBy !== undefined) {
      return
    }
    endedBy = why
    clearTimeout(deadline)
    for (const signal of signals) {
      signal.removeEventListener('abort', onAbort)
    }
    controller.abort(new LifetimeEndedError(why))
  }
  const onAbort = (): void => {
    finish('aborted')
  }
  const deadline = setTimeout(() => {
    finish('deadline')
  }, ms)
  for (const signal of signals) {
    signal.addEventListener('abort', onAbort, { once: true })
  }
  if (signals.some((signal) => signal.aborted)) {
    finish('aborted')
  }
  return {
    signal: controller.signal,
    deadlineAt: now() + ms,
    get endedBy() {
      return endedBy
    },
    cleaned,
    async step<T>(
      run: (signal: AbortSignal) => Promise<T>,
      dispose?: (value: T) => Promise<void>,
    ): Promise<T> {
      const before = endOf()
      if (before !== undefined) {
        throw new LifetimeEndedError(before)
      }
      const running = run(controller.signal)
      const answered = (async (): Promise<{ readonly value: T }> => {
        const value = await running
        return { value }
      })()
      const first = await Promise.race([answered, ended])
      const after = endOf()
      if (first === ENDED || after !== undefined) {
        // Ended first, or a late answer: what it made is disposed by its
        // step, or closed, and it counts for nothing.
        void quietly(async () => {
          const value = await running
          if (dispose !== undefined) {
            await dispose(value)
          } else if (hasClose(value)) {
            await value.close()
          }
        })
        throw new LifetimeEndedError(after ?? 'ended')
      }
      return first.value
    },
    onEnd(cleanup: () => Promise<void>): void {
      if (endedBy === undefined) {
        cleanups.push(cleanup)
        return
      }
      // Registered after the end: run at once, alone.
      void quietly(cleanup)
    },
    end(): void {
      finish('ended')
    },
  }
}
