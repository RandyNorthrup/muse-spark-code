// A person-set session limit (M82, PLAN.md D121): a request is fitted into
// what is left by lowering its output allowance, and one whose smallest
// estimate would pass the limit is refused with the plain stop sentence.
import { describe, expect, it } from 'vitest'
import {
  fitRequest,
  SessionBudgetExceededError,
} from '../../src/core/backends/modelapi/sessionBudget'
import { DEFAULT_MODEL_ID } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'

describe('fitting a request into a session limit', () => {
  it('lowers the output allowance so the estimate fits what is left', () => {
    const fit = fitRequest({
      capUsd: Usd.from('1').toAmount(),
      spentUsd: Usd.from('0.99').toAmount(),
      estimatedInputTokens: 1000,
      modelId: DEFAULT_MODEL_ID,
      maxOutputTokens: 1_000_000,
    })
    expect(fit.maxOutputTokens).toBeGreaterThan(0)
    expect(fit.maxOutputTokens).toBeLessThan(1_000_000)
    expect(Usd.from(fit.estimateUsd).compare(Usd.from('0.01'))).toBeLessThanOrEqual(0)
  })

  it('keeps the requested allowance when it fits', () => {
    const fit = fitRequest({
      capUsd: Usd.from('100').toAmount(),
      spentUsd: Usd.from(0).toAmount(),
      estimatedInputTokens: 1000,
      modelId: DEFAULT_MODEL_ID,
      maxOutputTokens: 2000,
    })
    expect(fit.maxOutputTokens).toBe(2000)
  })

  it('refuses a request whose smallest estimate passes the limit, in plain words', () => {
    let refusal: unknown
    try {
      fitRequest({
        capUsd: Usd.from('120').toAmount(),
        spentUsd: Usd.from('119.99').toAmount(),
        estimatedInputTokens: 2_000_000,
        modelId: DEFAULT_MODEL_ID,
      })
    } catch (error: unknown) {
      refusal = error
    }
    expect(refusal).toBeInstanceOf(SessionBudgetExceededError)
    expect(refusal instanceof Error ? refusal.message : '').toMatch(
      /^Stopped: the next request \(about \$\d+\.\d{2}\) would pass the session budget of \$120\.00 \(\$119\.99 used\)\. It was not sent\.$/u,
    )
  })
})
