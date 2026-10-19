import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import { MODEL_API_MAX_OUTPUT_TOKENS } from '../../src/shared/constants'
import { reviewerAnswerSchema } from '../../src/shared/sideCallSchemas'

describe('M106 loop contracts', () => {
  it('adds structured output and a hosted bound without adding bytes to an off request', () => {
    const base: CreateResponseBody = {
      model: 'muse-spark-1.3',
      input: [],
      instructions: 'Fixed session instructions',
      tools: [],
      tool_choice: 'auto',
      reasoning: { effort: 'minimal' },
      stream: true,
      store: false,
      include: [],
      max_output_tokens: MODEL_API_MAX_OUTPUT_TOKENS,
      prompt_cache_key: 'fixed-key',
      prompt_cache_retention: 'in_memory',
    }
    const enhanced: CreateResponseBody = {
      ...base,
      // A person-set hosted bound, e.g. 5 (the default sends no max).
      max_tool_calls: 5,
      text: {
        format: {
          type: 'json_schema',
          name: 'reviewer_answer',
          schema: z.toJSONSchema(reviewerAnswerSchema),
          strict: true,
        },
      },
    }
    const { max_tool_calls: bound, text, ...off } = enhanced
    expect(JSON.stringify(off)).toBe(JSON.stringify(base))
    expect(bound).toBe(5)
    expect(text?.format.strict).toBe(true)
    expect(enhanced.instructions).toBe(base.instructions)
    expect(enhanced.tools).toBe(base.tools)
    expect(enhanced.prompt_cache_key).toBe(base.prompt_cache_key)
  })
})
