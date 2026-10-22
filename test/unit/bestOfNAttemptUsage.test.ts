// Real recorded provider replies, not invented billing amounts. Provenance:
// M106 sequences 34/37 (2026-10-05), manifest.json and m106-captures.md;
// REASONSHAPES OR-UNSUP (2026-10-13 UTC), capture's method/URL/body and
// docs/certification/REASONSHAPES.md. Replaying these files sends no request.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { responseSchema } from '../../src/core/backends/modelapi/schemas'
import { accumulateAttemptUsage } from '../../src/core/bestOfN/attemptUsage'
import { Usd } from '../../src/shared/usd'

function capturedMetaUsage(name: string) {
  const raw: unknown = JSON.parse(
    readFileSync(new URL(`../fixtures/m106/${name}`, import.meta.url), 'utf8'),
  )
  const { response } = z.object({ response: responseSchema }).parse(raw)
  if (response.usage == null || response.model === undefined)
    throw new Error('Captured response has no model or usage')
  return {
    modelId: response.model,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cachedTokens: response.usage.input_tokens_details?.cached_tokens ?? 0,
    },
  }
}

function capturedReportedCost() {
  const raw: unknown = JSON.parse(
    readFileSync(
      new URL('../fixtures/provider-reasoning/openrouter/OR-UNSUP.json', import.meta.url),
      'utf8',
    ),
  )
  const { response } = z
    .object({
      response: z.object({
        model: z.string(),
        usage: z.object({
          prompt_tokens: z.number(),
          completion_tokens: z.number(),
          cost: z.number(),
          prompt_tokens_details: z.object({ cached_tokens: z.number() }),
        }),
      }),
    })
    .parse(raw)
  return {
    modelId: response.model,
    usage: {
      inputTokens: response.usage.prompt_tokens,
      outputTokens: response.usage.completion_tokens,
      cachedTokens: response.usage.prompt_tokens_details.cached_tokens,
      costUsd: Usd.from(response.usage.cost).toAmount(),
    },
  }
}

describe('attempt usage from recorded provider replies', () => {
  it('sums separate Meta replies without inventing a reported cost', () => {
    const first = capturedMetaUsage('u10-structured-output.json')
    const second = capturedMetaUsage('u8-hosted-bound.json')
    const total = accumulateAttemptUsage(
      accumulateAttemptUsage(undefined, first.modelId, first.usage),
      second.modelId,
      second.usage,
    )
    expect(total).toEqual({
      reportedInputTokens: 2712,
      reportedOutputTokens: 736,
      hasUnreportedCost: true,
    })
  })

  it('keeps exact reported spend and marks a mixed receipt total partial', () => {
    const { modelId, usage } = capturedReportedCost()
    const reported = accumulateAttemptUsage(undefined, modelId, usage)
    expect(reported).toEqual({
      reportedInputTokens: 6,
      reportedOutputTokens: 5,
      reportedCostUsd: '0.00000091',
      hasUnreportedCost: false,
    })
    // A separate attempt receiving the same recorded receipt has its own total.
    expect(accumulateAttemptUsage(undefined, modelId, usage)).toEqual(reported)
    const summed = accumulateAttemptUsage(reported, modelId, usage)
    expect(summed.reportedCostUsd).toBe('0.00000182')
    expect(summed.reportedInputTokens).toBe(12)
    expect(summed.reportedOutputTokens).toBe(10)
    const third = accumulateAttemptUsage(summed, modelId, usage)
    expect(third.reportedCostUsd).toBe('0.00000273')
    expect(third.reportedInputTokens).toBe(18)
    expect(third.reportedOutputTokens).toBe(15)
    const missing = capturedMetaUsage('u10-structured-output.json')
    const partial = accumulateAttemptUsage(summed, missing.modelId, missing.usage)
    expect(partial.reportedCostUsd).toBe('0.00000182')
    expect(partial.hasUnreportedCost).toBe(true)
    expect(reported.hasUnreportedCost).toBe(false)
    // A later receipt never clears an earlier gap: the total stays partial.
    const gapFirst = accumulateAttemptUsage(undefined, missing.modelId, missing.usage)
    expect(gapFirst.hasUnreportedCost).toBe(true)
    const stillPartial = accumulateAttemptUsage(gapFirst, modelId, usage)
    expect(stillPartial.reportedCostUsd).toBe('0.00000091')
    expect(stillPartial.hasUnreportedCost).toBe(true)
    expect(stillPartial.reportedInputTokens).toBe(599)
    expect(stillPartial.reportedOutputTokens).toBe(52)
  })
})
