// The uncapped hook send's estimates (D121): with no output budget sent,
// the pacing estimate counts the input side only (never NaN), and a manual
// thinking step keeps its full size instead of shrinking under a cap that
// was never sent. Real helpers, real arithmetic, no stand-ins.
import { describe, expect, it } from 'vitest'
import { estimatedStreamTokens } from '../../src/core/backends/modelapi/modelPolicy'
import { manualThinkingBudget } from '../../src/core/providers/configured'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'

/** A hook body for a record-silent model: the output key never sent. */
function uncappedBody(): CreateResponseBody {
  const wire: Record<string, unknown> = {
    model: 'unrecorded-vendor/unrecorded-model',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'decide this' }],
      },
    ],
    instructions: 'answer as JSON',
    tools: [],
    tool_choice: 'auto',
    reasoning: { effort: 'minimal', summary: 'auto' },
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
  }
  return wire as unknown as CreateResponseBody
}

describe('estimatedStreamTokens with no output budget sent', () => {
  it('counts the input side only, a finite number', () => {
    const body = uncappedBody()
    expect('max_output_tokens' in body).toBe(false)
    const estimate = estimatedStreamTokens(body, undefined)
    expect(Number.isFinite(estimate)).toBe(true)
    expect(estimate).toBe(
      Buffer.byteLength(JSON.stringify([body.input, body.instructions, body.tools]), 'utf8'),
    )
  })
})

describe('manualThinkingBudget with no output cap sent', () => {
  it('keeps the full step', () => {
    expect(manualThinkingBudget(4096, undefined)).toBe(4096)
  })

  it('still fits the step under a cap that was sent', () => {
    // min(4096, max(1024, 2048 - 1024)): the room-for-the-answer rule.
    expect(manualThinkingBudget(4096, 2048)).toBe(1024)
    // min(4096, max(1024, 131072 - 1024)): a roomy cap keeps the step.
    expect(manualThinkingBudget(4096, 131_072)).toBe(4096)
  })
})
