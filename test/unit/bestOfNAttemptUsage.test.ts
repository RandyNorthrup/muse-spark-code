// Per-attempt reported spend (M77 C-M77-2, PLAN.md D49): the runner folds
// each attempt's validated per-response deltas into the attempt record, so
// the run, the comparison and the take notice show what that attempt
// reported. Pure accumulation through the real module, with values as data.

import { describe, expect, it } from 'vitest'
import { accumulateAttemptUsage } from '../../src/core/bestOfN/attemptUsage'
import { Usd } from '../../src/shared/usd'

const PRICED = 'muse-spark-1.1'
const UNPRICED = 'no-such-model'

describe('accumulateAttemptUsage', () => {
  it('sums tokens and reported costs over deltas', () => {
    const first = accumulateAttemptUsage(undefined, PRICED, {
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 10,
      costUsd: Usd.from('0.0005').toAmount(),
    })
    expect(first).toEqual({
      reportedInputTokens: 100,
      reportedOutputTokens: 50,
      reportedCostUsd: '0.0005',
      hasUnreportedCost: false,
    })
    const second = accumulateAttemptUsage(first, PRICED, {
      inputTokens: 200,
      outputTokens: 25,
      cachedTokens: 0,
      costUsd: Usd.from('0.001').toAmount(),
    })
    expect(second.reportedInputTokens).toBe(300)
    expect(second.reportedOutputTokens).toBe(75)
    expect(second.reportedCostUsd).toBe('0.0015')
    expect(second.hasUnreportedCost).toBe(false)
  })

  it('marks the total partial when a delta carries no reported cost', () => {
    const total = accumulateAttemptUsage(undefined, PRICED, {
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
    })
    expect(total.reportedInputTokens).toBe(100)
    expect(total.reportedCostUsd).toBeUndefined()
    expect(total.hasUnreportedCost).toBe(true)
    const mixed = accumulateAttemptUsage(total, PRICED, {
      inputTokens: 10,
      outputTokens: 5,
      cachedTokens: 0,
      costUsd: Usd.from('0.0001').toAmount(),
    })
    expect(mixed.reportedCostUsd).toBe('0.0001')
    expect(mixed.hasUnreportedCost).toBe(true)
  })

  it('refuses an unpriced model without a reported cost', () => {
    expect(() =>
      accumulateAttemptUsage(undefined, UNPRICED, {
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 0,
      }),
    ).toThrow('unpriced model')
  })

  it('refuses invalid counts before recording anything', () => {
    for (const usage of [
      { inputTokens: -1, outputTokens: 0, cachedTokens: 0 },
      { inputTokens: 1.5, outputTokens: 0, cachedTokens: 0 },
      { inputTokens: 10, outputTokens: 0, cachedTokens: 11 },
    ]) {
      expect(() => accumulateAttemptUsage(undefined, PRICED, usage)).toThrow(
        'nonnegative token counts',
      )
    }
  })
})
