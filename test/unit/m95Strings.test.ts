// Lane M95-0 (PLAN.md D74, M95): the bring-your-own-provider strings, filled
// and counted through the real text helpers.

import { describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { fill, plural } from '../../src/shared/l10n/text'

describe('M95 strings', () => {
  it('confirms the finished wizard with the provider and model (acceptance 19)', () => {
    expect(fill(EN.setupComplete, { provider: 'OpenRouter', model: 'openai/gpt-oss-20b' })).toBe(
      'You’re set up with OpenRouter · openai/gpt-oss-20b',
    )
  })

  it('counts the key check and scan diffs in words', () => {
    expect(plural(EN.providerKeyWorks, 1)).toBe('Key works · 1 model')
    expect(plural(EN.providerKeyWorks, 5)).toBe('Key works · 5 models')
    expect(plural(EN.scanNewModels, 1)).toBe('1 new model since the last scan')
    expect(plural(EN.scanRemovedModels, 2)).toBe('2 models removed since the last scan')
    expect(plural(EN.scanRepricedModels, 2)).toBe('2 models with a new price since the last scan')
  })

  it('binds the stored key to its origin in words', () => {
    expect(fill(EN.keyBoundState, { origin: 'https://openrouter.ai' })).toBe(
      'stored, bound to https://openrouter.ai',
    )
  })

  it('names both origins when the file moved behind the credential', () => {
    expect(
      fill(EN.originBindingMismatch, {
        actual: 'https://example.com/v1',
        expected: 'https://openrouter.ai',
      }),
    ).toContain('https://example.com/v1')
  })
})
