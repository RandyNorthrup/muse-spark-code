import { catalogueSliderProps } from '../../src/webview/components/EffortSlider'
import { describe, expect, it } from 'vitest'
import { EFFORT_LEVELS, MODEL_API_EFFORT_LEVELS } from '../../src/shared/constants'
import {
  effortAt,
  effortForThinking,
  effortIndex,
  effortLabel,
  effortLevelsFor,
  isEffortLevel,
  resolveReasoning,
  type ReasoningControl,
} from '../../src/shared/effort'

// The catalogue tests assert the carried props, never a selection: the
// callback is an unused selection sink.
function ignoreTierSelection(): void {
  return undefined
}

describe('effort helpers', () => {
  it.each([
    { variants: ['low', 'high', 'turbo'], expected: ['low', 'high'] },
    { variants: [], expected: [] },
    { variants: 'unknown', expected: [] },
  ] as const)('treats served $variants as authoritative', ({ variants, expected }) => {
    expect(effortLevelsFor('muse-spark-1.3', ['medium'], 'museCode', { variants })).toEqual(
      expected,
    )
  })

  it('uses only recorded BYO effort tiers, with an empty unknown range', () => {
    expect(effortLevelsFor('other/model')).toEqual([])
    expect(effortLevelsFor('other/model', ['low', 'high'])).toEqual(['low', 'high'])
  })

  it('recognises the UI tiers and rejects the rest of the wire vocabulary', () => {
    expect(isEffortLevel('xhigh')).toBe(true)
    expect(isEffortLevel('ultra')).toBe(true)
    expect(isEffortLevel('none')).toBe(false)
  })

  it('labels tiers the way Claude Code does', () => {
    expect(effortLabel('xhigh')).toBe('Extra High')
    expect(effortLabel('max')).toBe('Max')
  })

  it('sends none while thinking is off and the tier while it is on', () => {
    expect(effortForThinking('high', true)).toBe('high')
    expect(effortForThinking('high', false)).toBe('none')
  })

  it('lists the verified tiers per exact model id and the full range otherwise', () => {
    // Lane REASONSHAPES: `ultra` is Muse Code's client-side top tier,
    // mapped to the highest served tier at send time.
    const verified = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
    const capped = ['minimal', 'low', 'medium', 'high', 'xhigh']
    expect(effortLevelsFor('muse-spark-1.3')).toEqual(verified)
    expect(effortLevelsFor('muse-wonder-1.0')).toEqual(verified)
    expect(effortLevelsFor('muse-wonder-full-1.0')).toEqual(verified)
    // `max` is not served on a contributor model (dev.meta.ai/docs/
    // reasoning), nor on muse-spark-1.2/1.1 (the 1.2 live 400), so no
    // contributor id inherits its base row by prefix.
    for (const model of [
      'muse-spark-1.3-contributor',
      'muse-spark-1.2',
      'muse-spark-1.2-contributor',
      'muse-spark-1.1',
      'muse-wonder-1.0-contributor',
      'muse-wonder-full-1.0-contributor',
    ]) {
      expect(effortLevelsFor(model)).toEqual(capped)
    }
    expect(effortLevelsFor('some-future-model')).toBe(EFFORT_LEVELS)
    expect(effortLevelsFor(undefined)).toBe(EFFORT_LEVELS)
  })

  it('builds no catalogue props where the row carries no catalogue', () => {
    expect(catalogueSliderProps(undefined, 'high', () => undefined)).toBeUndefined()
    expect(catalogueSliderProps({ variants: undefined }, 'high', () => undefined)).toBeUndefined()
  })

  it('builds the slider catalogue path with the row default and current', () => {
    const onSelectTier = ignoreTierSelection
    expect(
      catalogueSliderProps(
        {
          variants: ['minimal', 'turbo'],
          reasoningEffortVariants: [{ tier: 'turbo', description: 'Fastest' }],
          defaultReasoningEffort: 'turbo',
        },
        'turbo',
        onSelectTier,
      ),
    ).toEqual({
      variants: ['minimal', 'turbo'],
      reasoningEffortVariants: [{ tier: 'turbo', description: 'Fastest' }],
      defaultReasoningEffort: 'turbo',
      current: 'turbo',
      onSelect: onSelectTier,
    })
  })

  it('offers the Model API vocabulary without ultra on that backend', () => {
    // The Model API has no `ultra` value (dev.meta.ai/docs/reasoning):
    // the backend offers the table without it, even where `max` is served.
    const apiFull = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    expect(effortLevelsFor('muse-spark-1.3', undefined, 'modelApi')).toEqual(apiFull)
    expect(effortLevelsFor('muse-wonder-1.0', undefined, 'modelApi')).toEqual(apiFull)
    expect(effortLevelsFor('muse-spark-1.3-contributor', undefined, 'modelApi')).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ])
    expect(effortLevelsFor('some-future-model', undefined, 'modelApi')).toBe(
      MODEL_API_EFFORT_LEVELS,
    )
    expect(effortLevelsFor(undefined, undefined, 'modelApi')).toBe(MODEL_API_EFFORT_LEVELS)
  })

  it('maps tiers to slider positions and clamps positions back to tiers', () => {
    const levels = effortLevelsFor('muse-spark-1.3')
    expect(effortIndex(levels, 'minimal')).toBe(0)
    expect(effortIndex(levels, 'max')).toBe(5)
    expect(effortIndex(['low', 'high'], 'medium')).toBe(-1)
    expect(effortAt(levels, -1)).toBe('minimal')
    expect(effortAt(levels, 3)).toBe('high')
    expect(effortAt(levels, 99)).toBe('ultra')
    expect(effortAt(['medium', 'high'], 1)).toBe('high')
  })

  it('sends listed levels as named and never substitutes a neighbour', () => {
    // DeepSeek takes its full vocabulary as named (DS-ULTRA, DS-XHIGH,
    // 2026-10-12): the record lists it, so every name rides unchanged.
    const deepseek: ReasoningControl = {
      effortLevels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      canDisable: true,
      thinkingOff: 'thinking-switch',
    }
    expect(resolveReasoning(deepseek, 'ultra')).toEqual({ kind: 'effort', effort: 'ultra' })
    expect(resolveReasoning(deepseek, 'xhigh')).toEqual({ kind: 'effort', effort: 'xhigh' })
    expect(resolveReasoning(deepseek, 'none')).toEqual({ kind: 'off' })
    const locked: ReasoningControl = { ...deepseek, canDisable: false }
    expect(resolveReasoning(locked, 'none')).toEqual({
      kind: 'refuse',
      code: 'unsupported_reasoning_effort',
    })
    // An unlisted level takes the provider default; a name outside the UI
    // range still refuses. No neighbour is ever sent in its place.
    const sparse: ReasoningControl = {
      effortLevels: ['low', 'high', 'max'],
      canDisable: true,
      thinkingOff: 'thinking-switch',
    }
    expect(resolveReasoning(sparse, 'ultra')).toEqual({ kind: 'default' })
    expect(resolveReasoning(sparse, 'medium')).toEqual({ kind: 'default' })
    expect(resolveReasoning(sparse, 'turbo')).toEqual({
      kind: 'refuse',
      code: 'unsupported_reasoning_effort',
    })
  })
})
