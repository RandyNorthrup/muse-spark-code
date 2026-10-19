import { describe, expect, it } from 'vitest'
import { SessionOwner } from '../../src/core/schedules/sessionOwner'

describe('SessionOwner quarantine', () => {
  it('refuses turns while quarantined, and a later applied mode recovers', () => {
    const owner = new SessionOwner('onRequest')
    expect(owner.currentMode).toBe('onRequest')
    expect(owner.quarantined).toBe(false)
    expect(owner.start(owner.token())).toBe(true)
    // A failed profile step quarantines instead of leaving the new mode
    // committed: the host runs a mode whose reviewer is not installed, so
    // no turn may run on it.
    owner.quarantine()
    expect(owner.quarantined).toBe(true)
    expect(owner.currentMode).toBeUndefined()
    expect(owner.start(owner.token())).toBe(false)
    expect(owner.canSteer(owner.token(), 'turn-missing')).toBe(false)
    // Quarantine gates turns, not the recovery: the next mode change still
    // runs, and applying it clears the quarantine.
    const effect = owner.modeEffect(owner.token(), 'promptUnmatched')
    if (effect === undefined) {
      expect.unreachable('the recovery mode change must run while quarantined')
    }
    expect(owner.modeApplied(effect, true)).toBe(true)
    expect(owner.quarantined).toBe(false)
    expect(owner.currentMode).toBe('promptUnmatched')
    expect(owner.start(owner.token())).toBe(true)
  })

  it('a refused command releases its effect but keeps the mode', () => {
    const owner = new SessionOwner('onRequest')
    const token = owner.token()
    const effect = owner.modeEffect(token, 'promptUnmatched')
    if (effect === undefined) {
      expect.unreachable('the mode change must be admitted while no turn runs')
    }
    // The host refused the mode command: it still runs the previous mode
    // with its reviewer, so the pending effect releases without forgetting
    // the mode and without quarantining — turns stay live.
    expect(owner.modeApplied(effect, false)).toBe(false)
    expect(owner.currentMode).toBe('onRequest')
    expect(owner.quarantined).toBe(false)
    expect(owner.start(owner.token())).toBe(true)
    // The released effect admits the retry, which then applies.
    const retry = owner.modeEffect(owner.token(), 'promptUnmatched')
    if (retry === undefined) {
      expect.unreachable('the retry must run once the refusal released the effect')
    }
    expect(owner.modeApplied(retry, true)).toBe(true)
    expect(owner.currentMode).toBe('promptUnmatched')
  })
})
