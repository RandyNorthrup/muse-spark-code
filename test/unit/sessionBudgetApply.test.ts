// The wizard's spending-limit validation (src/host/models/sessionBudget.ts)
// answers from the setting's own schema alone: no store is involved. The
// store-backed write paths — through the real VS Code configuration — run
// in test/integration/sessionBudget.test.ts.
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { canonicalUsd, usdAmountSchema } from '../../src/shared/usdSchema'
import { validateWizardSessionBudget } from '../../src/host/models/sessionBudget'

describe('validateWizardSessionBudget', () => {
  it('leaves an untouched budget alone', () => {
    expect(validateWizardSessionBudget(undefined, canonicalUsd(10))).toBeUndefined()
  })

  it('accepts the effective value with its prefill beside it', () => {
    expect(validateWizardSessionBudget(canonicalUsd(10), canonicalUsd(10))).toBeUndefined()
  })

  it('fails a changed value with no prefill to compare against', () => {
    expect(validateWizardSessionBudget(canonicalUsd(5), undefined)).toBe(
      UI_TEXT.wizardSessionBudgetInvalid,
    )
  })

  it('fails a value the setting schema refuses with the fixed words', () => {
    // '-5' is a well-formed signed amount, so the schema parse below needs
    // no cast; the setting itself takes only non-negative values.
    const negative = usdAmountSchema.parse('-5')
    expect(validateWizardSessionBudget(negative, canonicalUsd(10))).toBe(
      UI_TEXT.wizardSessionBudgetInvalid,
    )
  })
})
