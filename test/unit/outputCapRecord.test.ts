import { describe, expect, it } from 'vitest'
import { modelPolicyFor, outputCapForRequest } from '../../src/core/backends/modelapi/modelPolicy'
import {
  MODEL_API_MAX_OUTPUT_TOKENS,
  MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
} from '../../src/shared/constants'

// B1 (limits-output): the request cap is the selected model's own record
// maximum, not the fixed legacy value. Pure logic through the real policy
// module: model ids in, token counts out.
describe('record output cap', () => {
  it('uses the Meta record maximum, not the legacy cap', () => {
    expect(modelPolicyFor('muse-spark-1.3').output.maxTokens).toBe(
      MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
    )
    expect(
      outputCapForRequest(undefined, modelPolicyFor('muse-spark-1.3'), MODEL_API_MAX_OUTPUT_TOKENS),
    ).toBe(MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS)
  })

  it('keeps the legacy cap while the record states no maximum', () => {
    const policy = modelPolicyFor('custom/unknown-model')
    expect(policy.output.maxTokens).toBeUndefined()
    expect(outputCapForRequest(undefined, policy, MODEL_API_MAX_OUTPUT_TOKENS)).toBe(
      MODEL_API_MAX_OUTPUT_TOKENS,
    )
  })

  it('lets an explicit override win inside the record clamp', () => {
    const policy = modelPolicyFor('muse-spark-1.3')
    expect(outputCapForRequest(4096, policy, MODEL_API_MAX_OUTPUT_TOKENS)).toBe(4096)
    expect(outputCapForRequest(1_000_000, policy, MODEL_API_MAX_OUTPUT_TOKENS)).toBe(
      MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
    )
  })

  it('refuses an override below the provider minimum', () => {
    expect(() =>
      outputCapForRequest(8, modelPolicyFor('muse-spark-1.3'), MODEL_API_MAX_OUTPUT_TOKENS),
    ).toThrow(RangeError)
  })
})
