import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompanionSessions } from '../../src/runtime/companion/sessions'

afterEach(() => vi.useRealTimers())

describe('companion launch codes', () => {
  it('mints independent 256-bit codes and tokens, burns once, and permits a fresh window', () => {
    const sessions = new CompanionSessions(1000, 2000, 2)
    const code = sessions.issue()
    const session = sessions.exchange(code)!
    expect(code).toMatch(/^[a-f\d]{64}$/)
    expect(session.id).toMatch(/^[a-f\d]{64}$/)
    expect(session.id).not.toBe(code)
    expect(sessions.exchange(code)).toBeUndefined()
    expect(sessions.exchange('wrong')).toBeUndefined()
    expect(sessions.get(session.id)).toEqual(session)
    expect(sessions.get(code)).toBeUndefined()
    const fresh = sessions.issue()
    expect(fresh).not.toBe(code)
    expect(sessions.exchange(fresh)).toBeDefined()
  })
  it('refuses launch codes and tokens exactly at expiry', () => {
    vi.useFakeTimers()
    const sessions = new CompanionSessions(1000, 2000, 2)
    const session = sessions.exchange(sessions.issue())!
    const code = sessions.issue()
    vi.advanceTimersByTime(1000)
    expect(sessions.exchange(code)).toBeUndefined()
    expect(sessions.get(session.id)).toEqual(session)
    vi.advanceTimersByTime(1000)
    expect(sessions.get(session.id)).toBeUndefined()
  })
  it('bounds pending codes and sessions and releases expired capacity', () => {
    vi.useFakeTimers()
    const sessions = new CompanionSessions(1000, 2000, 1)
    sessions.issue()
    expect(() => sessions.issue()).toThrow('EPANEL_SESSIONS')
    vi.advanceTimersByTime(1000)
    const session = sessions.exchange(sessions.issue())!
    expect(() => sessions.issue()).toThrow('EPANEL_SESSIONS')
    vi.advanceTimersByTime(2000)
    expect(sessions.issue()).toBeDefined()
    expect(sessions.get(session.id)).toBeUndefined()
  })
  it('revokes all credentials at shutdown and isolates starts', () => {
    const sessions = new CompanionSessions(1000, 2000, 2)
    const code = sessions.issue()
    const session = sessions.exchange(sessions.issue())!
    const other = new CompanionSessions(1000, 2000, 2)
    expect(other.exchange(code)).toBeUndefined()
    expect(other.get(session.id)).toBeUndefined()
    sessions.clear()
    expect(sessions.exchange(code)).toBeUndefined()
    expect(sessions.get(session.id)).toBeUndefined()
  })
})
