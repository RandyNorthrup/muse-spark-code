import { describe, expect, it } from 'vitest'
import {
  effortNotForModelText,
  listModelsRemedy,
  unknownModelRefText,
  unknownProviderModelText,
} from '../../src/core/unknownModel'

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

describe('effortNotForModelText', () => {
  it('names the effort, the model, and the valid levels', () => {
    const text = effortNotForModelText('ultra', 'muse-spark-1.3', ['low', 'high'])
    expect(text).toContain('ultra')
    expect(text).toContain('muse-spark-1.3')
    expect(text).toContain('low')
    expect(text).toContain('high')
  })
})
