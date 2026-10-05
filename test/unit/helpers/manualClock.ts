// A clock the test drives (M96 lane B): `advance` moves time forward, firing
// due timers and delays in due order. Shared by the registry and bridge
// tests so the two never drift apart.

import type { RegistryClock } from '../../../src/core/team/resources'

interface Scheduled {
  callback: () => void
  at: number
  cancelled: boolean
}

interface Delayed {
  resolve: () => void
  at: number
}

export function createManualClock(startAt = 1000): {
  readonly clock: RegistryClock
  advance(ms: number): void
} {
  let now = startAt
  const scheduled: Scheduled[] = []
  const delayed: Delayed[] = []
  const clock: RegistryClock = {
    now: () => now,
    delay: (ms: number) =>
      new Promise<void>((resolve) => {
        delayed.push({ resolve, at: now + ms })
      }),
    schedule: (callback: () => void, ms: number) => {
      const entry: Scheduled = { callback, at: now + ms, cancelled: false }
      scheduled.push(entry)
      return {
        cancel: () => {
          entry.cancelled = true
        },
      }
    },
  }
  return {
    clock,
    advance(ms: number): void {
      now += ms
      const due = scheduled.splice(0).toSorted((left, right) => left.at - right.at)
      for (const entry of due) {
        if (!entry.cancelled && entry.at <= now) {
          entry.callback()
        } else if (!entry.cancelled) {
          scheduled.push(entry)
        }
      }
      for (const entry of delayed.splice(0)) {
        if (entry.at <= now) {
          entry.resolve()
        } else {
          delayed.push(entry)
        }
      }
    },
  }
}
