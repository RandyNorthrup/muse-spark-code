// M95 (PLAN.md D74): the request carries a validated output cap. A ceiling
// below the provider's known minimum refuses with the minimum's sentence;
// the ceiling clamps to the policy maximum. Ported from the session-level
// RVMINOUT P2 drills in modelApiLoopGuarantees.test.ts (removed by main's
// test overhaul together with its M106 session rig): the per-request
// resolution that made those pass is now the per-request ResolvedModel
// memo, so this pure boundary carries the regression. A session-level
// refresh test (a provider-file edit between turns changing the next cap)
// needs that rig and stays open for the lead; see docs/certification/msm95.md.

import { describe, expect, it } from 'vitest'
import { modelPolicyFor, outputLimitFor } from '../../src/core/backends/modelapi/modelPolicy'
import { MODEL_API_MIN_OUTPUT_TOKENS } from '../../src/shared/constants'
import { outputTokenMinimumMessage } from '../../src/shared/providerRouting'

function expectMinimumRefused(policy: ReturnType<typeof modelPolicyFor>): void {
  for (const ceiling of [0, 1, 15]) {
    expect(() => outputLimitFor(policy, ceiling)).toThrow(
      outputTokenMinimumMessage(MODEL_API_MIN_OUTPUT_TOKENS),
    )
  }
  expect(outputLimitFor(policy, MODEL_API_MIN_OUTPUT_TOKENS)).toBe(MODEL_API_MIN_OUTPUT_TOKENS)
}

describe('provider output cap', () => {
  it('refuses a ceiling below the provider minimum with the minimum sentence', () => {
    expectMinimumRefused(
      modelPolicyFor('acme/muse-spark-1.3', {
        capabilities: { toolCalling: true },
        maxOutputTokens: 64,
        minOutputTokens: MODEL_API_MIN_OUTPUT_TOKENS,
      }),
    )
  })

  it('clamps the ceiling to the policy maximum', () => {
    const policy = modelPolicyFor('acme/muse-spark-1.3', {
      capabilities: { toolCalling: true },
      maxOutputTokens: 64,
    })
    expect(outputLimitFor(policy, 128)).toBe(64)
    expect(outputLimitFor(policy, 32)).toBe(32)
  })

  it('refuses a Meta ceiling below sixteen', () => {
    expectMinimumRefused(modelPolicyFor('muse-spark-1.3', { capabilities: { toolCalling: true } }))
  })
})
