// One accelerated lease pulse, then a suspended process: suites observe the
// takeover and old-pulse behavior without a two-second setup in every case.
// Callers restore the spy (directly or through `vi.restoreAllMocks`).
import { vi } from 'vitest'
import { SCHEDULE_LEASE_HEARTBEAT_MS } from '../../../../src/shared/constants'

export function accelerateLeaseHeartbeat(afterMs: number) {
  const interval = globalThis.setInterval
  return vi.spyOn(globalThis, 'setInterval').mockImplementation((callback, ms, ...args) => {
    if (ms !== SCHEDULE_LEASE_HEARTBEAT_MS) return interval(callback, ms, ...args)
    const timer = interval(() => {
      clearInterval(timer)
      callback(...args)
    }, afterMs)
    return timer
  })
}
