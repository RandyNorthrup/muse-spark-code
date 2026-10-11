import { describe, expect, it } from 'vitest'
import {
  messageItemSchema,
  messageText,
  usageSchema,
} from '../../src/core/backends/modelapi/schemas'

describe('messageText', () => {
  it('reads output text and a refusal’s own words, skipping other parts (D26)', () => {
    const item = messageItemSchema.parse({
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'output_text', text: 'Part one. ' },
        { type: 'refusal', refusal: 'I can’t help with that.' },
        { type: 'audio_transcript', data: 'ignored' },
      ],
    })
    expect(messageText(item)).toBe('Part one. I can’t help with that.')
  })
})

it('preserves normalized provider dollars and rejects negative or non-finite cost before accounting', () => {
  const counts = { input_tokens: 10, output_tokens: 2 }
  for (const cost of [0, 0.125]) {
    expect(usageSchema.parse({ ...counts, provider_cost_usd: cost }).provider_cost_usd).toBe(cost)
  }
  for (const cost of [-1, NaN, Infinity]) {
    expect(usageSchema.safeParse({ ...counts, provider_cost_usd: cost }).success).toBe(false)
  }
})
