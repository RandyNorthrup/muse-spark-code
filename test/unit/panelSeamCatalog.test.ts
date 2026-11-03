import { describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { createModelsPanelSeam } from '../../src/core/providers/panelSeam'

// The panel seam carries each preset's privacy note to the credential
// step (PROV-HONEST): Gemini's store=false sentence rides the gemini
// card, and a preset without one stays silent.
describe('panel seam preset privacy notes', () => {
  it('carries the Gemini store sentence and nothing elsewhere', () => {
    const seam = createModelsPanelSeam({
      configFile: 'providers.json',
      subscriptionModels: () => Promise.resolve([]),
    })
    expect(seam.catalog.get('gemini')?.privacyNote).toBe(EN.providerText.privacyNotes.geminiStore)
    for (const id of seam.catalog.ids()) {
      if (id !== 'gemini') expect(seam.catalog.get(id)?.privacyNote).toBeUndefined()
    }
  })
})
