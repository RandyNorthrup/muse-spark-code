// The vault's one expiry reading (src/shared/vaultExpiry.ts) in several time
// zones: a day alone is the start of that day where the person is, a day and
// time without a zone is their local time, a zoned time is one instant
// everywhere, and nothing else is a date. TZ is set for this suite and put
// back afterwards, as l10n.test.ts does.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../../src/shared/constants'
import { readVaultExpiry } from '../../../src/shared/vaultExpiry'

const MINUTE_MS = 60_000
// Each zone's offset from UTC in January 2027, in minutes.
const ZONES = [
  { zone: 'UTC', offset: 0 },
  { zone: 'America/New_York', offset: -300 },
  { zone: 'Asia/Kolkata', offset: 330 },
  { zone: 'Pacific/Kiritimati', offset: 840 },
  { zone: 'Pacific/Pago_Pago', offset: -660 },
]
const LOOSE = [
  '1',
  '12/1',
  'next tuesday',
  '2026-02-30',
  '2027-02-29',
  '2027-13-01',
  '2027-1-15',
  '2027-01-15 09:30',
  '2027-01-15T24:00',
  '2027-01-15T09:60',
  '2027-01-15T09:30:00.5Z',
  '2027-01-15T09:30+5:30',
  'Jan 15 2027',
]

const zone = process.env['TZ']
afterAll(() => {
  if (zone === undefined) {
    delete process.env['TZ']
  } else {
    process.env['TZ'] = zone
  }
})

describe.each(ZONES)('a typed vault expiry in $zone', ({ zone: here, offset }) => {
  beforeAll(() => {
    process.env['TZ'] = here
  })

  it('reads a day alone as the start of that day there', () => {
    expect(readVaultExpiry('2027-01-15', 0, null)).toEqual({
      at: Date.UTC(2027, 0, 15) - offset * MINUTE_MS,
      refusal: null,
    })
  })

  it('reads a day and time without a zone as that local time there', () => {
    expect(readVaultExpiry('2027-01-15T09:30', 0, null).at).toBe(
      Date.UTC(2027, 0, 15, 9, 30) - offset * MINUTE_MS,
    )
    expect(readVaultExpiry('  2027-01-15T09:30:45.250 ', 0, null).at).toBe(
      Date.UTC(2027, 0, 15, 9, 30, 45, 250) - offset * MINUTE_MS,
    )
  })

  it('reads a zoned time as the same instant in every zone', () => {
    const instant = Date.UTC(2027, 0, 15, 9, 30)
    expect(readVaultExpiry('2027-01-15T09:30Z', 0, null).at).toBe(instant)
    expect(readVaultExpiry(new Date(instant).toISOString(), 0, null).at).toBe(instant)
    expect(readVaultExpiry('2027-01-15T15:00+05:30', 0, null).at).toBe(instant)
    expect(readVaultExpiry('2027-01-15T01:30:00-08:00', 0, null).at).toBe(instant)
  })

  it('refuses everything else as not a date', () => {
    for (const typed of LOOSE) {
      expect(readVaultExpiry(typed, 0, null)).toEqual({
        at: null,
        refusal: UI_TEXT.vault.expiresInvalid,
      })
    }
  })

  it('refuses the moment now and before, except the stored date an edit keeps', () => {
    const start = Date.UTC(2027, 0, 15) - offset * MINUTE_MS
    const passed = { at: null, refusal: UI_TEXT.vault.expiresPassed }
    expect(readVaultExpiry('2027-01-15', start, null)).toEqual(passed)
    expect(readVaultExpiry('2027-01-15', start + 1, null)).toEqual(passed)
    expect(readVaultExpiry('2027-01-15', start - 1, null).at).toBe(start)
    expect(readVaultExpiry('2027-01-15', start + 1, start).at).toBe(start)
    expect(readVaultExpiry('2027-01-14', start + 1, start)).toEqual(passed)
  })
})
