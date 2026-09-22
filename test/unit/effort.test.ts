import { describe, expect, it } from 'vitest'
import {
  effortAt,
  effortForThinking,
  effortIndex,
  effortLabel,
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

  it('maps tiers to slider positions and clamps positions back to tiers', () => {
    expect(effortIndex('low')).toBe(0)
    expect(effortIndex('max')).toBe(4)
    expect(effortAt(-1)).toBe('low')
    expect(effortAt(2)).toBe('high')
    expect(effortAt(99)).toBe('max')
  })
})
