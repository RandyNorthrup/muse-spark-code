// D119 catch burn-down: only ESRCH/EINVAL reads as not alive and only
// EPERM as alive. The process table answers for real below.
import { describe, expect, it } from 'vitest'
import { isScheduleProcessAlive } from '../../src/core/schedules/store'

describe('schedule process liveness', () => {
  it('reads the current process as alive', () => {
    expect(isScheduleProcessAlive(process.pid)).toBe(true)
  })

  it('reads an impossible process as not alive', () => {
    expect(isScheduleProcessAlive(2_147_483_647)).toBe(false)
  })
})
