import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// RVCM1063 #6: the Italian bad-result label names a poor result, as the
// other thirteen tables do — not an erroneous one.
describe('feedback classification labels', () => {
  it('labels a bad result as poor, not erroneous, in Italian', () => {
    const table = JSON.parse(readFileSync('l10n/ui.it.json', 'utf8')) as Record<string, string>
    expect(table['feedbackClassificationBadResult']).toBe('Brutto risultato')
  })
})
