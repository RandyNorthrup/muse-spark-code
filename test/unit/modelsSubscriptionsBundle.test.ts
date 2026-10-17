// PANELBUDGET (PLAN.md D6): activation keeps only the command
// registrations and the loaders; the subscriptions bundle loads on first
// use, and a missing or misshapen one refuses with an explicit error.

import { describe, expect, it } from 'vitest'
import {
  isModelsSubscriptionsBundle,
  modelsSubscriptionsLoader,
} from '../../src/host/models/modelsSubscriptionsBundle'
import { EN } from '../../src/shared/l10n/en'

describe('isModelsSubscriptionsBundle', () => {
  it('accepts the factory and refuses anything else', () => {
    expect(isModelsSubscriptionsBundle({ createSubscriptionFeatures: () => ({}) })).toBe(true)
    expect(isModelsSubscriptionsBundle({ createSubscriptionFeatures: 'x' })).toBe(false)
    for (const bad of [undefined, null, {}, { createModelsPanelFeatures: () => ({}) }]) {
      expect(isModelsSubscriptionsBundle(bad)).toBe(false)
    }
  })
})

function subscriptionsLoader(loadBundle: (file: string) => unknown) {
  return modelsSubscriptionsLoader({
    bundlePath: '/dist/modelsSubscriptions.js',
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    loadBundle,
  })
}

describe('the subscriptions loader', () => {
  it('refuses a missing subscriptions bundle with the panel unavailable', () => {
    const load = subscriptionsLoader(() => {
      throw new Error('no such file')
    })
    expect(() => load()).toThrow(EN.modelsPanelUnavailable)
  })

  it('refuses a misshapen bundle and loads a good one once', () => {
    let loads = 0
    const load = subscriptionsLoader(() => {
      loads += 1
      return { nope: true }
    })
    expect(() => load()).toThrow(EN.modelsPanelUnavailable)
    const good = subscriptionsLoader(() => {
      loads += 1
      return { createSubscriptionFeatures: () => ({}) }
    })
    expect(good()).toMatchObject({})
    expect(good()).toMatchObject({})
    expect(loads).toBe(2)
  })
})
