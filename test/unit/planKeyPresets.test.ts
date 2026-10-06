import { afterEach, describe, expect, it } from 'vitest'
import { PLAN_KEY_PRESETS, planKeyPresetById, presetById } from '../../src/core/providers/presets'

import fr from '../../l10n/ui.fr.json'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, fill, setUiText } from '../../src/shared/l10n/text'

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('captured plan-key presets', () => {
  it('reuses Mistral keys, endpoint and wire while marking monthly-credit billing as plan', () => {
    const plan = planKeyPresetById('mistral-plan')
    expect(plan).toBeDefined()
    const api = presetById('mistral')
    expect(plan).toMatchObject({
      auth: 'apiKey',
      format: 'chat',
      wireCapture: true,
      origin: api?.origin,
      authHeader: api?.authHeader,
      modelsList: api?.modelsList,
      pricing: { kind: 'plan' },
      limitsUrl: 'https://docs.mistral.ai/admin/billing-usage/subscriptions',
    })
    expect(plan?.keyPage).toBe(api?.keyPage)
    expect(plan?.keyShape).toEqual(api?.keyShape)
    if (plan === undefined) throw new Error('missing Mistral plan')
    expect(Object.keys(plan.pricing)).toEqual(['kind'])
  })
  it('reads the plan description and key hint in the language installed after import', () => {
    const plan = planKeyPresetById('mistral-plan')
    setUiText(fr, 'fr')
    expect(plan?.description).toBe(fr.providerText.descriptions.mistral)
    expect(plan?.keyHint).toBe(fill(fr.providerText.hints.site, { site: 'console.mistral.ai' }))
  })
  it('ships no uncaptured MiniMax or Alibaba plan wire, or prohibited plan sign-in', () => {
    expect(PLAN_KEY_PRESETS.every((preset) => preset.wireCapture)).toBe(true)
    for (const id of [
      'minimax-plan',
      'alibaba-plan',
      'anthropic-plan',
      'gemini-plan',
      'zai-plan',
      'kimi-plan',
    ]) {
      expect(planKeyPresetById(id)).toBeUndefined()
    }
  })
})
