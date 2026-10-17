import { describe, expect, it } from 'vitest'
import { isReservationLockHeld } from '../../src/host/backend/sessionBudgetJournal'

// Windows answers `mkdir` with EPERM, not EEXIST, while the lock directory of
// that name is still being removed by its last holder (measured 2026-10-12,
// docs/certification/session-lock-windows.md). The reservation lock waits
// that out like a held lock; every other answer is a failure of the store.
describe('which mkdir answers mean the reservation lock is held right now', () => {
  it('waits for a lock that exists, on every system', () => {
    expect(isReservationLockHeld('EEXIST', 'win32')).toBe(true)
    expect(isReservationLockHeld('EEXIST', 'linux')).toBe(true)
    expect(isReservationLockHeld('EEXIST', 'darwin')).toBe(true)
  })

  it('waits for a lock that is being removed, on Windows only', () => {
    expect(isReservationLockHeld('EPERM', 'win32')).toBe(true)
    expect(isReservationLockHeld('EPERM', 'linux')).toBe(false)
    expect(isReservationLockHeld('EPERM', 'darwin')).toBe(false)
  })

  it('waits for nothing else', () => {
    expect(isReservationLockHeld('EACCES', 'win32')).toBe(false)
    expect(isReservationLockHeld('ENOSPC', 'win32')).toBe(false)
    expect(isReservationLockHeld('ENOENT', 'linux')).toBe(false)
    expect(isReservationLockHeld(undefined, 'win32')).toBe(false)
  })
})
