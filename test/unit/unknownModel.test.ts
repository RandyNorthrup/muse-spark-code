import { describe, expect, it } from 'vitest'
import {
  effortNotForModelText,
  listModelsRemedy,
  refEntryName,
  unknownModelRefText,
  unknownProviderModelText,
} from '../../src/core/unknownModel'
import { createProviderRegistry } from '../../src/core/providers/providerRegistry'

// A refusal names what was refused and why: the model id as typed, the
// entry that does not offer it, and what the person can do.
describe('unknownProviderModelText', () => {
  it('names the typed id, the entry, and the remedy', () => {
    const text = unknownProviderModelText('nope-9', 'openai', listModelsRemedy())
    expect(text).toContain('nope-9')
    expect(text).toContain('openai')
    expect(text).toContain('providers list')
  })

  it('carries a caller-supplied remedy for entries with no list command', () => {
    const text = unknownProviderModelText('dflt', 'acme', 'Pass --model acme/id.')
    expect(text).toContain('dflt')
    expect(text).toContain('acme')
    expect(text).toContain('--model acme/id')
  })
})

describe('unknownModelRefText', () => {
  it('names the provider entry for a slashed id it does not offer', () => {
    const text = unknownModelRefText('openai/nope-9')
    expect(text).toContain('openai/nope-9')
    expect(text).toContain('openai')
    expect(text).toContain('providers list')
  })

  it('sends a bare id to the reserved lane with the pick-offered remedy', () => {
    const text = unknownModelRefText('muse-spark-9')
    expect(text).toContain('muse-spark-9')
    expect(text).toContain('meta')
    expect(text).not.toContain('providers list')
  })

  it('never repeats the old nameless refusal', () => {
    expect(unknownModelRefText('openai/nope-9')).not.toBe(
      'This model is not available for this run.',
    )
  })
})

describe('refEntryName', () => {
  it('sends bare ids to the reserved lane and slashed ids to their entry', () => {
    expect(refEntryName('muse-spark-1.3')).toBe('meta')
    expect(refEntryName('openai/nope-9')).toBe('openai')
    expect(refEntryName('openrouter/author/slug')).toBe('openrouter')
  })
})

// The registry's own refusal, through the real module with data-only deps:
// the failure path never builds a client.
describe('providerRegistry.resolve', () => {
  const deps = {
    models: () => Promise.resolve([]),
    createClient: () => Promise.reject(new Error('never called')),
    isCurrent: () => true,
  }
  it('names the typed id and the entry that does not offer it', async () => {
    const registry = createProviderRegistry(deps)
    await expect(registry.resolve('openai/nope-9')).rejects.toThrow('openai/nope-9')
    await expect(registry.resolve('openai/nope-9')).rejects.toThrow('openai')
  })
})

describe('effortNotForModelText', () => {
  it('names the effort, the model, and the valid levels', () => {
    const text = effortNotForModelText('ultra', 'muse-spark-1.3', ['low', 'high'])
    expect(text).toContain('ultra')
    expect(text).toContain('muse-spark-1.3')
    expect(text).toContain('low')
    expect(text).toContain('high')
  })

  it('says the model offers no levels instead of listing none', () => {
    // A BYO model serves no known effort levels (effortLevelsFor returns
    // [] for a slashed ref): "Use one of: ." names no remedy.
    const text = effortNotForModelText('high', 'openai/gpt-5', [])
    expect(text).toContain('high')
    expect(text).toContain('openai/gpt-5')
    expect(text).toContain('no effort levels')
    expect(text).not.toContain('Use one of: .')
  })
})
