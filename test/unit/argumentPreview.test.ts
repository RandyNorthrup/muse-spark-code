import { describe, expect, it } from 'vitest'
import { ArgumentPreview } from '../../src/core/backends/modelapi/argumentPreview'
import { agentEventSchema } from '../../src/shared/agentEvents'
import { REDACTED_MARK, TOOL_ARGUMENT_PREVIEW_MAX_CHARS } from '../../src/shared/constants'
import { toSnapshot, wireItemSchema } from '../../src/core/backends/musecode/sessionRecords'

describe('display-only argument prefixes', () => {
  it('streams complete content lines while withholding the unfinished line', () => {
    const preview = new ArgumentPreview()
    expect(preview.append(String.raw`{"path":"a.ts","content":"first\nsec`).text).toBe(
      '{"path":"a.ts","content":"first\n',
    )
    expect(preview.append(String.raw`ond\nthird`).text).toContain('first\nsecond\n')
    expect(
      preview.finish(String.raw`{"path":"a.ts","content":"first\nsecond\nthird"}`).text,
    ).toContain('first\nsecond\nthird')
  })

  it('scrubs credentials split at every character before emitting any preview', () => {
    // Public synthetic strings; no actual key is read or retained.
    const secret = `LLM_${'x'.repeat(24)}`
    const args = JSON.stringify({
      content: `safe line\n${secret}\nafter\n`,
      password: 'dummy-value',
    })
    const preview = new ArgumentPreview()
    for (const character of args) {
      const text = preview.append(character).text
      expect(text).not.toContain('LLM_')
      expect(text).not.toContain('dummy-value')
    }
    expect(preview.finish(args).text).toContain(REDACTED_MARK)
    expect(preview.snapshot().text).toContain('after')
  })

  it('decodes escaped Unicode before scrubbing and holds a split bearer introducer', () => {
    const preview = new ArgumentPreview()
    expect(preview.append(String.raw`{"content":"safe\nBearer\n`).text).toBe('{"content":"safe\n')
    expect(preview.append(String.raw`dummy-token\nafter\n`).text).not.toContain('dummy-token')
    expect(
      preview.finish(String.raw`{"content":"\u004cLM_` + 'x'.repeat(24) + '"}').text,
    ).toContain(REDACTED_MARK)
    expect(preview.snapshot().text).not.toContain('LLM_')
  })

  it('scrubs multiline named credentials before decoding their JSON escapes', () => {
    const preview = new ArgumentPreview()
    const args = JSON.stringify({ password: 'dummy-first\ndummy-second', content: 'safe' })
    const text = preview.finish(args).text
    expect(text).not.toContain('dummy-first')
    expect(text).not.toContain('dummy-second')
    expect(text).toContain('safe')
  })

  it('keeps a PEM block split across lines out of all emitted previews', () => {
    const preview = new ArgumentPreview()
    const boundary = 'PRIVATE KEY'
    const fragments = [
      String.raw`{"content":"safe\n-----BEGIN ${boundary}-----\n`,
      String.raw`dummy-body\n`,
      String.raw`-----END ${boundary}-----\nafter\n"}`,
    ]
    for (const fragment of fragments) {
      const text = preview.append(fragment).text
      expect(text).not.toContain('dummy-body')
      expect(text).not.toContain('PRIVATE KEY')
    }
    expect(preview.snapshot().text).toContain('after')
  })

  it('bounds accumulated and final previews without clipping a credential into visible bytes', () => {
    const preview = new ArgumentPreview()
    const lead = String.raw`line\n`.repeat(TOOL_ARGUMENT_PREVIEW_MAX_CHARS / 2)
    const first = preview.append(`{"content":"${lead}`)
    expect(first.truncated).toBe(true)
    expect(first.text.length).toBeLessThanOrEqual(TOOL_ARGUMENT_PREVIEW_MAX_CHARS)
    expect(preview.append('tail'.repeat(TOOL_ARGUMENT_PREVIEW_MAX_CHARS))).toEqual(first)
    const credentialAtCap = JSON.stringify({
      content: 'a'.repeat(TOOL_ARGUMENT_PREVIEW_MAX_CHARS - 30) + `LLM_${'x'.repeat(100)}`,
    })
    const final = preview.finish(credentialAtCap)
    expect(final.truncated).toBe(true)
    expect(final.text).not.toContain('LLM_')
    expect(final.text.length).toBeLessThanOrEqual(TOOL_ARGUMENT_PREVIEW_MAX_CHARS)
  })

  it('uses done arguments authoritatively and ignores later deltas', () => {
    const preview = new ArgumentPreview()
    preview.append('{"content":"stale')
    const done = preview.finish('{"content":"authoritative"}')
    expect(done).toEqual({ text: '{"content":"authoritative"}', truncated: false })
    expect(preview.append('ignored')).toEqual(done)
  })

  it('holds incomplete escapes and refuses malformed strings without throwing', () => {
    const preview = new ArgumentPreview()
    expect(preview.append(String.raw`{"content":"one\n\u00`).text).toBe('{"content":"')
    expect(preview.append('61\\n\\').text).toContain('one\n')
    expect(new ArgumentPreview().finish(String.raw`{"content":"bad\q"}`).text).toBe('{"content":')
    expect(new ArgumentPreview().finish('{"content":"bad\n"}').text).toBe('{"content":')
    expect(new ArgumentPreview().snapshot()).toEqual({ text: '', truncated: false })
  })

  it('validates preview events independently of executable arguments at the shared boundary', () => {
    const item = {
      itemId: 'preview',
      turnId: 'turn',
      kind: 'toolCall',
      status: 'inProgress',
      tool: 'write_file',
      args: '',
      argumentPreview: { text: 'safe', truncated: false },
    }
    expect(agentEventSchema.safeParse({ type: 'toolArgumentPreview', item }).success).toBe(true)
    expect(
      agentEventSchema.safeParse({ type: 'toolArgumentPreview', item: { ...item, args: '{}' } })
        .success,
    ).toBe(false)
    expect(
      agentEventSchema.safeParse({
        type: 'toolArgumentPreview',
        item: {
          ...item,
          argumentPreview: {
            text: 'x'.repeat(TOOL_ARGUMENT_PREVIEW_MAX_CHARS + 1),
            truncated: false,
          },
        },
      }).success,
    ).toBe(false)
  })

  it('keeps extension previews out of the Muse Code wire schema', () => {
    const parsed = wireItemSchema.parse({
      itemId: 'wire',
      kind: 'toolCall',
      status: 'inProgress',
      argumentPreview: { text: 'untrusted wire text', truncated: false },
    })
    expect(toSnapshot(parsed).argumentPreview).toBeUndefined()
  })
})
