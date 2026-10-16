import { describe, expect, it } from 'vitest'
import { isContinued } from '../../src/runtime/exec/sessionTap'
import type { LastResponse } from '../../src/runtime/exec/execProtocol'
import { resolveExecOutputCap } from '../../src/runtime/exec/runLedger'
import { modelPolicyFor, outputCapForRequest } from '../../src/core/backends/modelapi/modelPolicy'
import {
  MODEL_API_MAX_OUTPUT_TOKENS,
  MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
} from '../../src/shared/constants'

// B1 (limits-output): the request cap is the selected model's own record
// maximum, not the fixed legacy value. Pure logic through the real policy
// module: model ids in, token counts out.
describe('record output cap', () => {
  it('releases only a clean, uninterrupted max-token continuation chain', () => {
    const stopped: LastResponse = {
      n: 1,
      terminal: 'incomplete',
      incompleteReason: 'max_output_tokens',
      endedWithoutTerminal: false,
      httpStatus: null,
      transportError: null,
      usage: 'valid',
      settlement: 'priced',
    }
    const done: LastResponse = { ...stopped, n: 2, terminal: 'completed', incompleteReason: null }
    expect(
      isContinued(
        new Map([
          [1, stopped],
          [2, done],
        ]),
        1,
      ),
    ).toBe(true)
    expect(
      isContinued(
        new Map([
          [1, { ...stopped, incompleteReason: 'content_filter' }],
          [2, done],
        ]),
        1,
      ),
    ).toBe(false)
    expect(
      isContinued(
        new Map([
          [1, stopped],
          [2, { ...done, transportError: 'error' }],
        ]),
        1,
      ),
    ).toBe(false)
    expect(
      isContinued(
        new Map([
          [1, stopped],
          [2, { ...done, terminal: 'failed' }],
          [3, { ...done, n: 3 }],
        ]),
        1,
      ),
    ).toBe(false)
  })
  it('uses the record maximum for exec reservations as well as interactive sends', () => {
    expect(resolveExecOutputCap(modelPolicyFor('muse-spark-1.3'))).toBe(131_072)
    expect(resolveExecOutputCap({ output: { maxTokens: 65_536 } })).toBe(65_536)
    expect(resolveExecOutputCap({ output: { maxTokens: 4096 } })).toBe(4096)
    expect(() => resolveExecOutputCap({ output: { maxTokens: NaN } })).toThrow(RangeError)
  })
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
