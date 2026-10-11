import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { CreateResponseBody } from '../../src/core/backends/modelapi/schemas'
import {
  MODEL_API_CONTINUATIONS_MAX,
  MODEL_API_MAX_OUTPUT_TOKENS,
  MODEL_API_MODEL_TEXT,
  MODEL_API_PARALLEL_READS,
  MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
  PACING_START_REQUESTS_PER_MINUTE,
  PACING_WINDOW_MS,
  STRUCTURED_OUTPUT_REPAIRS_MAX,
  TOOL_ARGUMENT_PREVIEW_MAX_CHARS,
  TOOL_REPEAT_LIMIT,
  WEB_SEARCH_MAX_PER_REQUEST,
  WEB_SEARCH_MAX_PER_REQUEST_LIMIT,
  WEB_SEARCH_MIN_PER_REQUEST,
} from '../../src/shared/constants'
import { reviewerAnswerSchema } from '../../src/shared/sideCallSchemas'

const goldenSchema = z.object({ scenario: z.string(), requests: z.array(z.string()) })

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
      max_tool_calls: WEB_SEARCH_MAX_PER_REQUEST,
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
    expect(bound).toBe(WEB_SEARCH_MAX_PER_REQUEST)
    expect(text?.format.strict).toBe(true)
    expect(enhanced.instructions).toBe(base.instructions)
    expect(enhanced.tools).toBe(base.tools)
    expect(enhanced.prompt_cache_key).toBe(base.prompt_cache_key)
  })

  it('keeps the legacy output cap until the model-record clamp is integrated', () => {
    const raw: unknown = JSON.parse(
      readFileSync(
        new URL('../fixtures/golden-requests/01-plain-turn.json', import.meta.url),
        'utf8',
      ),
    )
    const golden = goldenSchema.parse(raw)
    const caps = golden.requests.map((request) => {
      const value: unknown = JSON.parse(request)
      return z.object({ max_output_tokens: z.number() }).parse(value).max_output_tokens
    })
    expect(caps).toEqual([MODEL_API_MAX_OUTPUT_TOKENS])
    expect(MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS).toBe(131_072)
    expect(MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS).toBeGreaterThan(MODEL_API_MAX_OUTPUT_TOKENS)
  })

  it('fixes the plan’s concurrency, continuation, repair and repetition bounds', () => {
    expect(MODEL_API_PARALLEL_READS).toBe(4)
    expect(MODEL_API_CONTINUATIONS_MAX).toBe(1)
    expect(STRUCTURED_OUTPUT_REPAIRS_MAX).toBe(1)
    expect(TOOL_REPEAT_LIMIT).toBe(3)
    expect(TOOL_ARGUMENT_PREVIEW_MAX_CHARS).toBe(16_000)
    expect(MODEL_API_MODEL_TEXT.toolRepeatStopped).toContain('not run again')
    expect(MODEL_API_MODEL_TEXT.continuationPrompt).toContain('Do not repeat')
  })

  it('provides a bounded search default and a conservative startup pace', () => {
    expect(WEB_SEARCH_MAX_PER_REQUEST).toBe(5)
    expect(WEB_SEARCH_MIN_PER_REQUEST).toBe(1)
    expect(WEB_SEARCH_MAX_PER_REQUEST_LIMIT).toBe(20)
    expect(PACING_WINDOW_MS).toBe(60_000)
    expect(PACING_START_REQUESTS_PER_MINUTE).toBeGreaterThan(0)
    expect(PACING_START_REQUESTS_PER_MINUTE).toBeLessThan(150)
  })
})
