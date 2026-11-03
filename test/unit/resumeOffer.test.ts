// M88 lane C: a limit's resume offer fits the timed-send picker. A
// Retry-After of seconds opens at one minute; a reset tonight opens at
// its own minute; a weekly lift gets no timer, only its instant.
import { describe, expect, it } from 'vitest'
import { ceilToMinuteMs, resumeOfferFor } from '../../src/shared/resumeOffer'

const FAILED_AT = Date.UTC(2026, 10, 1, 12, 0, 30)

describe('resume offer fitting', () => {
  it('opens a seconds-out Retry-After at one minute, on the minute', () => {
    expect(resumeOfferFor(FAILED_AT, FAILED_AT + 5000)).toEqual({
      kind: 'timer',
      defaultAtMs: Date.UTC(2026, 10, 1, 12, 2),
    })
  })

  it('opens a later lift at its own minute, rounded up', () => {
    expect(resumeOfferFor(FAILED_AT, Date.UTC(2026, 10, 1, 19, 42, 18))).toEqual({
      kind: 'timer',
      defaultAtMs: Date.UTC(2026, 10, 1, 19, 43),
    })
  })

  it('gives no timer past six days, only the lift instant', () => {
    const liftsAtMs = FAILED_AT + 7 * 24 * 60 * 60 * 1000
    expect(resumeOfferFor(FAILED_AT, liftsAtMs)).toEqual({ kind: 'liftsAt', liftsAtMs })
  })

  it('still times a lift exactly six days out', () => {
    const liftsAtMs = FAILED_AT + 6 * 24 * 60 * 60 * 1000
    expect(resumeOfferFor(FAILED_AT, liftsAtMs)).toEqual({
      kind: 'timer',
      defaultAtMs: Math.ceil(liftsAtMs / 60_000) * 60_000,
    })
  })

  it('refuses an instant it cannot fit instead of an empty offer', () => {
    expect(() => resumeOfferFor(NaN, FAILED_AT)).toThrow(RangeError)
    expect(() => resumeOfferFor(FAILED_AT, NaN)).toThrow(RangeError)
    expect(() => resumeOfferFor(FAILED_AT, -1)).toThrow(RangeError)
    expect(() => ceilToMinuteMs(Infinity)).toThrow(RangeError)
  })
})
