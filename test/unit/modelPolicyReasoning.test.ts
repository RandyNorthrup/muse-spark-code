// M95c part 2: the editor-chat gate reads whether the model's record
// says reasoning runs at all, apart from its effort levels. Unknown is
// unknown: only the record's own flag resolves it.
import { describe, expect, it } from 'vitest'
import { modelPolicyFor } from '../../src/core/backends/modelapi/modelPolicy'

describe('modelPolicy reasoning support', () => {
  it('carries the record reasoning flag as yes, no or unknown', () => {
    expect(
      modelPolicyFor('openai/gpt-5', { capabilities: { reasoning: true } }).reasoning.supported,
    ).toEqual({ state: 'yes', value: true })
    expect(
      modelPolicyFor('openai/gpt-5', { capabilities: { reasoning: false } }).reasoning.supported,
    ).toEqual({ state: 'no' })
    expect(modelPolicyFor('openai/gpt-5', {}).reasoning.supported).toEqual({ state: 'unknown' })
    expect(modelPolicyFor('openai/gpt-5').reasoning.supported).toEqual({ state: 'unknown' })
  })
})
