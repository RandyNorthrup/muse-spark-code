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

it('reads normalized provider dollars as exact amounts and rejects negative or non-finite cost before accounting', () => {
  const counts = { input_tokens: 10, output_tokens: 2 }
  // M121: the receipt is an exact decimal string, never a binary number.
  for (const [cost, exact] of [
    [0, '0'],
    [0.125, '0.125'],
    [0.1 + 0.2, '0.30000000000000004'],
    ['0.123456789012', '0.123456789012'],
  ] as const) {
    expect(usageSchema.parse({ ...counts, provider_cost_usd: cost }).provider_cost_usd).toBe(exact)
  }
  for (const cost of [-1, NaN, Infinity]) {
    expect(usageSchema.safeParse({ ...counts, provider_cost_usd: cost }).success).toBe(false)
  }
})
