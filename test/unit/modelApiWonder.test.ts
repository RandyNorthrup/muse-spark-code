// Muse Wonder 1.0 on the Meta Model API backend: listed (the
// `muse-spark-` prefix no longer decides what is Meta), priced at its
// own Standard-mode tariff ($4.00 in, $0.20 cached, $20.00 out per
// million, dev.meta.ai/docs/pricing-rate-limits read 2026-10-22),
// governed by the Meta minimums, and capable everywhere except strict
// tools, whose support is unmeasured on Wonder.
import { describe, expect, it } from 'vitest'
import { metaModelFacts } from '../../src/core/backends/modelapi/modelCapabilities'
import { modelPolicyFor, outputLimitFor } from '../../src/core/backends/modelapi/modelPolicy'
import { isModelApiModelId, MODEL_API_MIN_OUTPUT_TOKENS } from '../../src/shared/constants'
import { modelApiPaidTier } from '../../src/shared/paidBoundary'

describe('muse-wonder-1.0 on the Model API backend', () => {
  it('counts as a Meta first-party model without matching the Spark prefix', () => {
    expect(isModelApiModelId('muse-wonder-1.0')).toBe(true)
    expect(isModelApiModelId('muse-spark-1.3')).toBe(true)
    expect(isModelApiModelId('acme/muse-wonder-1.0')).toBe(false)
    expect(isModelApiModelId('other/model')).toBe(false)
  })

  it('prices at the Wonder tariff in Standard mode', () => {
    expect(modelApiPaidTier('muse-wonder-1.0')).toBe('wonder')
    expect(modelPolicyFor('muse-wonder-1.0').pricing).toEqual({
      kind: 'priced',
      card: {
        input: 0.000004,
        cachedInput: 0.0000002,
        output: 0.00002,
        source: 'catalogue',
      },
    })
  })

  it('keeps the Meta reasoning, tools and output minimums', () => {
    const policy = modelPolicyFor('muse-wonder-1.0')
    expect(policy.reasoning.canDisable).toEqual({ state: 'yes', value: true })
    expect(policy.reasoning.effortLevels.state).toBe('yes')
    expect(policy.tools.calling).toEqual({ state: 'yes', value: true })
    expect(policy.output.minTokens).toBe(MODEL_API_MIN_OUTPUT_TOKENS)
    expect(outputLimitFor(policy, MODEL_API_MIN_OUTPUT_TOKENS)).toBe(MODEL_API_MIN_OUTPUT_TOKENS)
    expect(() => outputLimitFor(policy, 1)).toThrow()
  })

  it('carries tool calling, vision and reasoning but no strict tools', () => {
    const facts = metaModelFacts('muse-wonder-1.0')
    expect(facts?.capabilities).toEqual({
      toolCalling: true,
      vision: true,
      reasoning: true,
      parallelToolCalls: true,
    })
    expect(metaModelFacts('muse-spark-1.3')?.capabilities.supportsStrictTools).toBe(true)
    expect(facts?.quirks.cachedUsageFields).toEqual(['input_tokens_details.cached_tokens'])
  })
})
