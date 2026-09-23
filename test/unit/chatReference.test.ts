import { describe, expect, it } from 'vitest'
import { chatReferenceText } from '../../src/core/chatReference'
import { CHAT_REFERENCE_MAX_CHARS } from '../../src/shared/constants'

describe('chatReferenceText (M17)', () => {
  it('wraps a reply to an assistant output with who wrote it and what the user is doing', () => {
    const text = chatReferenceText({
      intent: 'reply',
      role: 'assistant',
      entryId: 'a1',
      text: 'Use pnpm.',
    })
    expect(text).toMatch(/^<chat_reference intent="reply" from="assistant">/)
    expect(text).toContain('replying to this earlier output')
    expect(text).toContain('written by you, the assistant.')
    expect(text).toContain('"""\nUse pnpm.\n"""')
    expect(text).toMatch(/<\/chat_reference>$/)
  })

  it('names the intent and the author for a question about a tool output and a comment on a user message', () => {
    const question = chatReferenceText({ intent: 'question', role: 'tool', text: 'exit 1' })
    expect(question).toContain('intent="question" from="tool"')
    expect(question).toContain('asking a question about it')
    expect(question).toContain('a tool the assistant ran.')
    const comment = chatReferenceText({ intent: 'comment', role: 'user', text: 'my prompt' })
    expect(comment).toContain('commenting on it')
    expect(comment).toContain('written by the user.')
    const unknown = chatReferenceText({ intent: 'comment', role: 'workflow', text: 'x' })
    expect(unknown).toContain('written by workflow.')
  })

  it('clips a long passage and says so', () => {
    const long = 'x'.repeat(CHAT_REFERENCE_MAX_CHARS + 10)
    const text = chatReferenceText({ intent: 'reply', role: 'assistant', text: long })
    expect(text).toContain('x'.repeat(CHAT_REFERENCE_MAX_CHARS))
    expect(text).not.toContain('x'.repeat(CHAT_REFERENCE_MAX_CHARS + 1))
    expect(text).toContain(`[… truncated to ${String(CHAT_REFERENCE_MAX_CHARS)} characters]`)
  })
})
