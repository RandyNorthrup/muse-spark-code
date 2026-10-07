// M95 lane K (PLAN.md D6): activation keeps only the command
// registrations and the loaders; the bundles load on first use, and a
// missing or misshapen one refuses with an explicit error.

import { describe, expect, it } from 'vitest'
import {
  isModelsPanelBundle,
  isModelsPanelSeam,
  modelsPanelLoader,
  providersSeamLoader,
} from '../../src/host/models/modelsPanelBundle'
import { EN } from '../../src/shared/l10n/en'

describe('isModelsPanelBundle', () => {
  it('accepts the factory and refuses anything else', () => {
    expect(
      isModelsPanelBundle({
        createModelsPanelFeatures: () => ({}),
        createSubscriptionFeatures: () => ({}),
      }),
    ).toBe(true)
    expect(isModelsPanelBundle({ createModelsPanelFeatures: () => ({}) })).toBe(false)
    for (const bad of [undefined, null, {}, { createModelsPanelFeatures: 'x' }]) {
      expect(isModelsPanelBundle(bad)).toBe(false)
    }
  })
})

describe('isModelsPanelSeam', () => {
  const member = {}
  const seam = {
    store: member,
    catalog: member,
    policy: member,
    tester: member,
    fetcher: member,
    exchanger: member,
    usage: member,
    pkce: member,
    suggest: member,
  }

  it('accepts the nine seam members and refuses anything else', () => {
    expect(isModelsPanelSeam(seam)).toBe(true)
    expect(isModelsPanelSeam({ ...seam, tester: undefined })).toBe(false)
    expect(isModelsPanelSeam({ ...seam, pkce: () => ({}) })).toBe(false)
    for (const bad of [undefined, null, [], 'seam', 7]) {
      expect(isModelsPanelSeam(bad)).toBe(false)
    }
  })
  it('accepts unavailable optional OpenRouter ports but refuses malformed services', () => {
    expect(isModelsPanelSeam({ ...seam, exchanger: undefined, usage: undefined })).toBe(true)
    expect(isModelsPanelSeam({ ...seam, exchanger: 'not a service' })).toBe(false)
  })
})

function seamLoader(loadBundle: (file: string) => unknown) {
  return providersSeamLoader({
    bundlePath: '/dist/providers.js',
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    loadBundle,
  })
}

describe('the bundle loaders', () => {
  it('refuses a missing panel bundle with the panel unavailable', () => {
    const load = modelsPanelLoader({
      bundlePath: '/dist/modelsPanel.js',
      log: {
        trace: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      loadBundle: () => {
        throw new Error('no such file')
      },
    })
    expect(() => load()).toThrow(EN.modelsPanelUnavailable)
  })

  it('refuses a misshapen seam bundle and loads a good one once', () => {
    let loads = 0
    const load = seamLoader(() => {
      loads += 1
      return { nope: true }
    })
    expect(() => load()).toThrow(EN.modelsPanelUnavailable)
    const good = seamLoader(() => {
      loads += 1
      return {
        store: {},
        catalog: {},
        policy: {},
        tester: {},
        fetcher: {},
        exchanger: {},
        usage: {},
        pkce: {},
        suggest: {},
      }
    })
    expect(good()).toMatchObject({ store: {} })
    expect(good()).toMatchObject({ store: {} })
    expect(loads).toBe(2)
  })
})
