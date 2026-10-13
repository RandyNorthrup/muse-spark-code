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

  it('maps documented aliases before matching, refusing only the truly unknown', () => {
    // DeepSeek's thinking-mode table (DS-G01): ultra rides as max.
    const deepseek: ReasoningControl = {
      effortLevels: ['low', 'high', 'max'],
      canDisable: true,
      thinkingOff: 'thinking-switch',
      effortAliases: { minimal: 'low', medium: 'high', xhigh: 'high', ultra: 'max' },
    }
    expect(resolveReasoning(deepseek, 'ultra')).toEqual({ kind: 'effort', effort: 'max' })
    expect(resolveReasoning(deepseek, 'xhigh')).toEqual({ kind: 'effort', effort: 'high' })
    expect(resolveReasoning(deepseek, 'none')).toEqual({ kind: 'off' })
    const locked: ReasoningControl = { ...deepseek, canDisable: false }
    expect(resolveReasoning(locked, 'none')).toEqual({
      kind: 'refuse',
      code: 'unsupported_reasoning_effort',
    })
    const unmapped: ReasoningControl = {
      effortLevels: ['low', 'high', 'max'],
      canDisable: true,
      thinkingOff: 'thinking-switch',
    }
    // Without the table, ultra falls to the nearest listed level while a
    // name outside the UI range still refuses.
    expect(resolveReasoning(unmapped, 'ultra')).toEqual({ kind: 'effort', effort: 'max' })
    expect(resolveReasoning(unmapped, 'turbo')).toEqual({
      kind: 'refuse',
      code: 'unsupported_reasoning_effort',
    })
  })
})
