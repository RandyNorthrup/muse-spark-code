// The host's own start (museServe, foreground) is the engine, not work: the
// governor's pause must never hold it, while background work still pauses.
import { describe, expect, it } from 'vitest'
import { ResourceEvents } from '../../src/core/resources/events'
import { ResourcePausedError } from '../../src/core/resources/launch'
import { ResourceQueue } from '../../src/core/resources/queue'
import type { ResourceClock, ResourceKind } from '../../src/shared/resources'

const clock: ResourceClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs)
    const cancel = (): void => {
      clearTimeout(timer)
    }
    return cancel
  },
}

const sleep = (ms: number): Promise<'waited'> =>
  new Promise((resolve) => {
    setTimeout(() => {
      resolve('waited')
    }, ms)
  })

function pausedQueue(errors: unknown[]): ResourceQueue {
  return new ResourceQueue({
    clock,
    events: new ResourceEvents((error: unknown) => {
      errors.push(error)
    }),
    // Exactly what ResourceGovernor.capacity returns at pause (governor.ts).
    capacity: (_kind: ResourceKind) => 0,
    running: { backgroundCount: () => 0 },
  })
}

describe('museServe engine admission at pause', () => {
  it('starts the foreground host at once instead of waiting out the pause', async () => {
    const errors: unknown[] = []
    const queue = pausedQueue(errors)
    const admission = queue.request({ kind: 'museServe', class: 'foreground', priority: 0 })
    try {
      const winner = await Promise.race([
        (async (): Promise<'permit'> => {
          await admission.ready
          return 'permit'
        })(),
        sleep(500),
      ])
      expect(winner).toBe('permit')
      expect(queue.counts()).toEqual([])
      const permit = await admission.ready
      expect(permit.kind).toBe('museServe')
      expect(permit.class).toBe('foreground')
      permit.release()
      expect(errors).toEqual([])
    } finally {
      admission.cancel()
    }
  })

  it('still refuses background work while paused', async () => {
    const errors: unknown[] = []
    const queue = pausedQueue(errors)
    const admission = queue.request({ kind: 'check', class: 'background', priority: 0 })
    await expect(admission.ready).rejects.toBeInstanceOf(ResourcePausedError)
  })
})
