import { describe, expect, it } from 'vitest'
import { messageItemSchema, messageText } from '../../src/core/backends/modelapi/schemas'

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
