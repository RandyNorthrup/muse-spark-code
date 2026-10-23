// C-M95-5: an Azure resource answers 404 for a deployment that is not
// there, and that one answer carries the product's own sentence instead
// of the provider's words. The gate reads the status only, so the body
// below is never parsed on this path; the fall-through cases prove the
// gate fires on 404 alone.
import { describe, expect, it } from 'vitest'
import { providerFailureReader } from '../../src/core/providers/configured'
import { presetById } from '../../src/core/providers/presets'
import type { ProviderEntry } from '../../src/core/providers/providersFile'
import { UI_TEXT } from '../../src/shared/constants'

function entry(preset: string): ProviderEntry {
  return { id: `${preset}-entry`, preset, auth: 'apiKey', models: [] }
}

describe('Azure deployment refusal', () => {
  it('refuses a missing deployment in the product words on 404 only', () => {
    const azure = presetById('azure')
    if (azure === undefined) throw new Error('missing azure preset')
    const reader = providerFailureReader(entry('azure'), azure)
    const refused = reader.parseError(404, undefined)
    expect(refused.status).toBe(404)
    expect(refused.message).toBe(UI_TEXT.azureDeploymentInvalid)
    expect(reader.parseError(503, undefined).message).not.toBe(UI_TEXT.azureDeploymentInvalid)
  })

  it('never reads the typed refusal for another preset', () => {
    const openai = presetById('openai')
    if (openai === undefined) throw new Error('missing openai preset')
    const reader = providerFailureReader(entry('openai'), openai)
    expect(reader.parseError(404, undefined).message).not.toBe(UI_TEXT.azureDeploymentInvalid)
  })
})
