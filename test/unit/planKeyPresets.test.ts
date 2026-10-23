import { afterEach, describe, expect, it } from 'vitest'
import {
  listedPlanKeyPresets,
  PLAN_KEY_PRESETS,
  planKeyPresetById,
  presetById,
} from '../../src/core/providers/presets'

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
    if (plan === undefined) throw new Error('missing Mistral plan')
    expect(Object.keys(plan.pricing)).toEqual(['kind'])
  })
  it('reads the plan description and key hint in the language installed after import', () => {
    const plan = planKeyPresetById('mistral-plan')
    const api = presetById('mistral')
    setUiText(fr, 'fr')
    // The plan key has its own sentence (subscription credits, not
    // pay-as-you-go); only the hint stays Mistral's.
    expect(plan?.description).toBe(fr.providerText.descriptions.mistralPlan)
    expect(plan?.description).not.toBe(api?.description)
    expect(plan?.label).toBe(fr.providerText.labels.mistralPlan)
    expect(plan?.label).not.toBe(api?.label)
    expect(plan?.keyHint).toBe(fill(fr.providerText.hints.site, { site: 'console.mistral.ai' }))
  })
  it('defines MiniMax and Alibaba plan keys uncaptured, with limits links and plan pricing', () => {
    for (const [id, limitsUrl] of [
      ['minimax-plan', 'https://platform.minimax.io/console/usage'],
      ['alibaba-plan', 'https://www.alibabacloud.com/help/en/model-studio/coding-plan-faq'],
    ] as const) {
      const plan = planKeyPresetById(id)
      expect(plan).toMatchObject({
        auth: 'apiKey',
        format: 'chat',
        wireCapture: false,
        pricing: { kind: 'plan' },
        limitsUrl,
      })
      expect(plan?.label.trim()).not.toBe('')
      expect(plan?.description.trim()).not.toBe('')
      expect(plan?.keyHint.trim()).not.toBe('')
      if (plan === undefined) throw new Error(`missing ${id}`)
      expect(Object.keys(plan.pricing)).toEqual(['kind'])
    }
    expect(planKeyPresetById('minimax-plan')?.origin).toEqual({
      kind: 'fixed',
      origin: 'https://api.minimax.io',
    })
    expect(planKeyPresetById('alibaba-plan')?.origin).toEqual({
      kind: 'fixed',
      origin: 'https://coding-intl.dashscope.aliyuncs.com',
    })
  })
  it('lists only captured plan keys in the panel, and never a prohibited plan sign-in', () => {
    expect(listedPlanKeyPresets().map((preset) => preset.id)).toEqual(['mistral-plan'])
    expect(PLAN_KEY_PRESETS.map((preset) => preset.id)).toEqual([
      'minimax-plan',
      'alibaba-plan',
      'mistral-plan',
    ])
    for (const id of ['anthropic-plan', 'gemini-plan', 'zai-plan', 'kimi-plan']) {
      expect(planKeyPresetById(id)).toBeUndefined()
    }
  })
  it('gives every plan key its documented key page for the wizard link', () => {
    for (const preset of PLAN_KEY_PRESETS) {
      expect(preset.keyPage, preset.id).toMatch(/^https:\/\//)
    }
    expect(planKeyPresetById('minimax-plan')?.keyPage).toBe(
      'https://platform.minimax.io/console/plan',
    )
  })
})
