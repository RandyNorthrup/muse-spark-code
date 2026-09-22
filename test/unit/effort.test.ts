import { describe, expect, it } from 'vitest'
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
  it('recognises the UI tiers and rejects the rest of the wire vocabulary', () => {
    expect(isEffortLevel('xhigh')).toBe(true)
    expect(isEffortLevel('ultra')).toBe(false)
    expect(isEffortLevel('none')).toBe(false)
  })

  it('labels tiers the way Claude Code does', () => {
    expect(effortLabel('xhigh')).toBe('Extra high')
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
