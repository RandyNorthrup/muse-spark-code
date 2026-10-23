import { describe, expect, it } from 'vitest'
import {
  contextLead,
  doneTailNote,
  failureTailHint,
  loopTailNote,
  lowerEffortLevel,
  rankedKeepIds,
  tailNotes,
  triageRoute,
} from '../../src/core/judge/fast/apply'

describe('fast path application', () => {
  it('names the loop pattern at the tail', () => {
    expect(loopTailNote('repeat', 'shell')).toBe(
      'The last three shell calls repeat the same call with the same result; try a different approach before calling it again.',
    )
    expect(loopTailNote('oscillation', 'shell')).toBe(
      'The last four tool calls alternate between two calls without progress; stop and reassess before calling again.',
    )
    expect(loopTailNote('same-failure', 'shell')).toBe(
      'The last three calls fail the same way; the failure needs a different approach, not another attempt.',
    )
    expect(tailNotes([])).toEqual([])
    expect(tailNotes(['a', 'b'])).toEqual([
      { role: 'developer', text: 'a' },
      { role: 'developer', text: 'b' },
    ])
  })

  it('notes backed done, unmentioned failures and ranked context', () => {
    expect(doneTailNote()).toBe(
      "The request's checks already passed; no further verification rounds are needed.",
    )
    expect(failureTailHint('shell')).toBe(
      'The last shell run reported a failure the reply does not mention; address it before continuing.',
    )
    expect(contextLead()).toBe('Context the judge ranked relevant to this request:')
  })

  it('lowers effort one level and never raises it', () => {
    const levels = ['minimal', 'low', 'medium', 'high']
    expect(lowerEffortLevel('medium', levels)).toBe('low')
    expect(lowerEffortLevel('minimal', levels)).toBe('minimal')
    expect(lowerEffortLevel('unknown', levels)).toBe('unknown')
    expect(lowerEffortLevel('medium', [])).toBe('medium')
  })

  it('packs blank successes and rides everything else whole with its reason', () => {
    expect(triageRoute({ decision: 'skip', reason: 'blank-success' }, 'none', false)).toEqual({
      action: 'pack',
    })
    expect(triageRoute({ decision: 'needs-full', reason: 'nonzero-exit' }, 'real', true)).toEqual({
      action: 'whole',
      unasked: 'recognised',
    })
    expect(triageRoute({ decision: 'miss' }, 'none', false)).toEqual({
      action: 'whole',
      unasked: 'no-window',
    })
    expect(triageRoute({ decision: 'miss' }, 'real', false)).toEqual({
      action: 'whole',
      unasked: 'no-engine',
    })
    expect(triageRoute({ decision: 'miss' }, 'none', true)).toEqual({
      action: 'whole',
      unasked: 'no-engine',
    })
  })

  it('ranks keep-lists and misses to empty', () => {
    const ids = rankedKeepIds('vitest failure output', [
      { id: 'a', text: 'the vitest run and its failure output' },
      { id: 'b', text: 'unrelated gardening notes' },
    ])
    expect(ids).toEqual(['a'])
    expect(rankedKeepIds('', [{ id: 'a', text: 'vitest' }])).toEqual([])
    expect(rankedKeepIds('vitest', [])).toEqual([])
  })
})
