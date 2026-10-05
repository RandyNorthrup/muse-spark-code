// A clock the test drives (M96 lane B): `advance` moves time forward, firing
// due timers in due order. Shared by the registry and bridge
// tests so the two never drift apart.

import type { RegistryClock } from '../../../src/core/team/resources'

interface Scheduled {
  callback: () => void
  at: number
  cancelled: boolean
}

export function createManualClock(startAt = 1000): {
  readonly clock: RegistryClock
  advance(ms: number): void
} {
  let now = startAt
  const scheduled: Scheduled[] = []
  const clock: RegistryClock = {
    now: () => now,
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
    },
  }
}
