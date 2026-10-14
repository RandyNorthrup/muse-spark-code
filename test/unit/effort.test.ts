import { describe, expect, it } from 'vitest'
import { EFFORT_LEVELS } from '../../src/shared/constants'
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

describe('effort helpers', () => {
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

  it('lists the verified tiers per model family and the full range otherwise', () => {
    // Lane REASONSHAPES: `ultra` is Muse Code's client-side top tier,
    // mapped to the highest served tier at send time.
    const verified = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
    expect(effortLevelsFor('muse-spark-1.3')).toEqual(verified)
    expect(effortLevelsFor('muse-spark-1.3-contributor')).toEqual(verified)
    expect(effortLevelsFor('muse-spark-1.2')).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh'])
    expect(effortLevelsFor('some-future-model')).toBe(EFFORT_LEVELS)
    expect(effortLevelsFor(undefined)).toBe(EFFORT_LEVELS)
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
