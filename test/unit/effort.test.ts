import { catalogueSliderProps } from '../../src/webview/components/EffortSlider'
import { describe, expect, it, vi } from 'vitest'
import { EFFORT_LEVELS } from '../../src/shared/constants'
import {
  effortAt,
  effortForThinking,
  effortIndex,
  effortLabel,
  effortLevelsFor,
  isEffortLevel,
} from '../../src/shared/effort'

describe('effort helpers', () => {
  it.each([
    { variants: ['low', 'high', 'turbo'], expected: ['low', 'high'] },
    { variants: [], expected: [] },
    { variants: 'unknown', expected: [] },
  ] as const)('treats served $variants as authoritative', ({ variants, expected }) => {
    expect(effortLevelsFor('muse-spark-1.3', ['medium'], { variants })).toEqual(expected)
  })

  it('uses only recorded BYO effort tiers, with an empty unknown range', () => {
    expect(effortLevelsFor('other/model')).toEqual([])
    expect(effortLevelsFor('other/model', ['low', 'high'])).toEqual(['low', 'high'])
  })

  it('recognises the UI tiers and rejects the rest of the wire vocabulary', () => {
    expect(isEffortLevel('xhigh')).toBe(true)
    expect(isEffortLevel('ultra')).toBe(false)
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

  it('lists the verified tiers per model family and the full range otherwise', () => {
    const verified = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    expect(effortLevelsFor('muse-spark-1.3')).toEqual(verified)
    expect(effortLevelsFor('muse-spark-1.3-contributor')).toEqual(verified)
    expect(effortLevelsFor('muse-spark-1.2')).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh'])
    expect(effortLevelsFor('some-future-model')).toBe(EFFORT_LEVELS)
    expect(effortLevelsFor(undefined)).toBe(EFFORT_LEVELS)
  })

  it('builds no catalogue props where the row carries no catalogue', () => {
    expect(catalogueSliderProps(undefined, 'high', vi.fn())).toBeUndefined()
    expect(catalogueSliderProps({ variants: undefined }, 'high', vi.fn())).toBeUndefined()
  })

  it('builds the slider catalogue path with the row default and current', () => {
    const onSelectTier = vi.fn()
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

  it('maps tiers to slider positions and clamps positions back to tiers', () => {
    const levels = effortLevelsFor('muse-spark-1.3')
    expect(effortIndex(levels, 'minimal')).toBe(0)
    expect(effortIndex(levels, 'max')).toBe(5)
    expect(effortIndex(['low', 'high'], 'medium')).toBe(-1)
    expect(effortAt(levels, -1)).toBe('minimal')
    expect(effortAt(levels, 3)).toBe('high')
    expect(effortAt(levels, 99)).toBe('max')
    expect(effortAt(['medium', 'high'], 1)).toBe('high')
  })
})
