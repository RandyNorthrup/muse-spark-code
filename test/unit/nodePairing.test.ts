// M110a P: the invitation text round-trips, fingerprints confirm across
// grouping and case, and unpair removes exactly the named pair.
import { describe, expect, it } from 'vitest'
import {
  isFingerprintMatch,
  formatFingerprint,
  formatInvitation,
  parseInvitation,
  unpair,
} from '../../src/core/devices/pairing'
import { EphemeralPairDirectory } from '../../src/core/devices/roles'

const FINGERPRINT = '0123456789abcdef'.repeat(4)
const INVITATION = { version: 1 as const, fingerprint: FINGERPRINT, payload: 'x2-bytes_here-9' }

describe('pairing', () => {
  it('the invitation text carries the version, fingerprint and payload', () => {
    const text = formatInvitation(INVITATION)
    expect(text.startsWith('muse-pair:1:')).toBe(true)
    expect(parseInvitation(text)).toEqual(INVITATION)
  })
  it('anything but the exact versioned form is refused, never repaired', () => {
    expect(parseInvitation('muse-pair:1:xyz:payload')).toBeUndefined()
    expect(parseInvitation('muse-pair:2:payload')).toBeUndefined()
    expect(parseInvitation(`muse-pair:1:${FINGERPRINT}:has space`)).toBeUndefined()
    expect(parseInvitation(`other:1:${FINGERPRINT}:payload`)).toBeUndefined()
    expect(parseInvitation('')).toBeUndefined()
  })
  it('the shown fingerprint matches the channel across case and grouping', () => {
    const shown = formatFingerprint(FINGERPRINT)
    expect(shown).toBe('0123 4567 89ab cdef '.repeat(4).trimEnd())
    expect(isFingerprintMatch(shown, FINGERPRINT)).toBe(true)
    expect(isFingerprintMatch(FINGERPRINT.toUpperCase(), shown)).toBe(true)
    expect(isFingerprintMatch(FINGERPRINT.replace('0', '1'), FINGERPRINT)).toBe(false)
    expect(isFingerprintMatch('too short', FINGERPRINT)).toBe(false)
  })
  it('unpair removes the named pair and says when it was never there', () => {
    const store = new EphemeralPairDirectory()
    store.add('pair-home')
    expect(unpair(store, 'pair-home')).toBe('unpaired')
    expect(store.isPaired('pair-home')).toBe(false)
    expect(unpair(store, 'pair-home')).toBe('unknown-pair')
    expect(() => unpair(store, '')).toThrow(/unpair needs a pair id/)
  })
})
