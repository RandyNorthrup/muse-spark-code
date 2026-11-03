import { describe, expect, it } from 'vitest'
import { formatDate, formatProviderDate } from '../../src/shared/l10n/text'

// A provider's announced day for a person: a calendar day renders as
// that day in every timezone, an instant parses as one, and anything
// else reads as it came, never blank.
describe('formatProviderDate', () => {
  it('renders a calendar day as that day, not its UTC midnight', () => {
    // Local-midnight construction: a bare UTC parse would read as the
    // day before west of Greenwich.
    expect(formatProviderDate('2027-01-14')).toBe(formatDate(new Date(2027, 0, 14).getTime()))
    expect(formatProviderDate('2026-12-01')).toContain('Dec 1, 2026')
  })

  it('parses an instant with its offset', () => {
    expect(formatProviderDate('2026-11-30T00:00:00Z')).toBe(
      formatDate(Date.parse('2026-11-30T00:00:00Z')),
    )
  })

  it('reads an unparseable value as it came', () => {
    expect(formatProviderDate('2026-13-99')).toBe('2026-13-99')
    expect(formatProviderDate('soon')).toBe('soon')
    expect(formatProviderDate('')).toBe('')
  })
})
