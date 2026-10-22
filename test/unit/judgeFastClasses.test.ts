// M125 lane 0: the shared eligibility rule the resolver, the recommender,
// the Done screen and the Judge section read. One function, so a class
// admits an engine in exactly one way everywhere.
import { describe, expect, it } from 'vitest'
import {
  FAST_DECISION_CLASS,
  FAST_DECISION_FALLBACK,
  FAST_DECISIONS,
  eligible,
  fastDeadlineMs,
} from '../../src/core/judge/fast/classes'
import {
  JUDGE_FAST_BOUNDARY_DEADLINE_MS,
  JUDGE_FAST_INLINE_DEADLINE_MS,
  JUDGE_FAST_SLACK_DEADLINE_MS,
} from '../../src/shared/constants'

describe('fast judge timing classes', () => {
  it('names every decision exactly one class and one fallback', () => {
    expect(Object.keys(FAST_DECISION_CLASS)).toEqual([...FAST_DECISIONS])
    expect(Object.keys(FAST_DECISION_FALLBACK)).toEqual([...FAST_DECISIONS])
    expect(FAST_DECISION_FALLBACK['triage.needFull']).toBe('whole-output')
    for (const id of FAST_DECISIONS) {
      if (id !== 'triage.needFull') expect(FAST_DECISION_FALLBACK[id]).toBe('today')
    }
  })

  it('reads its deadlines from the shared constants; post-turn has none', () => {
    expect(fastDeadlineMs('I')).toBe(JUDGE_FAST_INLINE_DEADLINE_MS)
    expect(fastDeadlineMs('S')).toBe(JUDGE_FAST_SLACK_DEADLINE_MS)
    expect(fastDeadlineMs('B')).toBe(JUDGE_FAST_BOUNDARY_DEADLINE_MS)
    expect(fastDeadlineMs('P')).toBeUndefined()
  })

  it('admits an engine only within its class budget', () => {
    // Inline fits nothing measured so far: a 0.36 s engine named for I fails.
    expect(eligible('I', 299, 'none')).toBe(true)
    expect(eligible('I', 300, 'none')).toBe(true)
    expect(eligible('I', 360, 'real')).toBe(false)
    expect(eligible('B', 2000, 'none')).toBe(true)
    expect(eligible('B', 2001, 'none')).toBe(false)
    expect(eligible('S', 5000, 'real')).toBe(true)
    expect(eligible('S', 5001, 'real')).toBe(false)
  })

  it('holds slack to a real window: a lone result has none', () => {
    expect(eligible('S', 100, 'real')).toBe(true)
    expect(eligible('S', 100, 'none')).toBe(false)
    // The window decides nothing for the other deadline classes.
    expect(eligible('I', 100, 'none')).toBe(true)
    expect(eligible('B', 100, 'none')).toBe(true)
  })

  it('counts a miss as fitting no deadline class, and post-turn as always fitting', () => {
    for (const timingClass of ['I', 'S', 'B'] as const) {
      expect(eligible(timingClass, Infinity, 'real')).toBe(false)
      expect(eligible(timingClass, NaN, 'real')).toBe(false)
    }
    expect(eligible('P', Infinity, 'none')).toBe(true)
  })
})
