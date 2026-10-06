import { describe, expect, it } from 'vitest'
import { ArgumentPreview } from '../../src/core/backends/modelapi/argumentPreview'
import { agentEventSchema } from '../../src/shared/agentEvents'
import { REDACTED_MARK, TOOL_ARGUMENT_PREVIEW_MAX_CHARS } from '../../src/shared/constants'
import { toSnapshot, wireItemSchema } from '../../src/core/backends/musecode/sessionRecords'

function append(preview: ArgumentPreview, delta: string) {
  preview.append(delta)
  return preview.snapshot()
}

function finish(preview: ArgumentPreview, args: string) {
  preview.finish(args)
  return preview.snapshot()
}

describe('display-only argument prefixes', () => {
  it('streams complete content lines while withholding the unfinished line', () => {
    const preview = new ArgumentPreview()
    expect(append(preview, String.raw`{"path":"a.ts","content":"first\nsec`).text).toBe(
      '{"path":"a.ts","content":"first\n',
    )
    expect(append(preview, String.raw`ond\nthird`).text).toContain('first\nsecond\n')
    expect(
      finish(preview, String.raw`{"path":"a.ts","content":"first\nsecond\nthird"}`).text,
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
      const text = append(preview, character).text
      expect(text).not.toContain('LLM_')
      expect(text).not.toContain('dummy-value')
    }
    expect(finish(preview, args).text).toContain(REDACTED_MARK)
    expect(preview.snapshot().text).toContain('after')
  })

  it('decodes escaped Unicode before scrubbing and holds a split bearer introducer', () => {
    const preview = new ArgumentPreview()
    expect(append(preview, String.raw`{"content":"safe\nBearer\n`).text).toBe('{"content":"safe\n')
    expect(append(preview, String.raw`dummy-token\nafter\n`).text).not.toContain('dummy-token')
    expect(
      finish(preview, String.raw`{"content":"\u004cLM_` + 'x'.repeat(24) + '"}').text,
    ).toContain(REDACTED_MARK)
    expect(preview.snapshot().text).not.toContain('LLM_')
  })

  it('scrubs multiline named credentials before decoding their JSON escapes', () => {
    const preview = new ArgumentPreview()
    const args = JSON.stringify({ password: 'dummy-first\ndummy-second', content: 'safe' })
    const text = finish(preview, args).text
    expect(text).not.toContain('dummy-first')
    expect(text).not.toContain('dummy-second')
    expect(text).toContain('safe')
  })

  it.each([
    [String.raw`{"\u0070assword":"dummy-first\n`, 'dummy-second"}'],
    [String.raw`{"\u0070ass`, String.raw`word":"dummy-first\ndummy-second"}`],
    [String.raw`{"password":"dummy-first\"`, String.raw`dummy-second\nend"}`],
    [String.raw`[{"PASSWORD":"dummy-first\uD83D`, String.raw`\uDE00dummy-second"}]`],
    ['{"ｐａｓｓｗｏｒｄ":"dummy-first', 'dummy-second"}'],
    [String.raw`{"nested":[{"api-key":"dummy-first\n`, 'dummy-second"}]}'],
  ])('withholds whole decoded sensitive strings across frames: %s', (first, second) => {
    const preview = new ArgumentPreview()
    for (const frame of [first, second]) {
      const text = append(preview, frame).text
      expect(text).not.toContain('dummy-first')
      expect(text).not.toContain('dummy-second')
    }
    expect(preview.snapshot().text).toContain(REDACTED_MARK)
  })

  it('preserves a surrogate pair split inside Unicode escapes', () => {
    const preview = new ArgumentPreview()
    append(preview, String.raw`{"content":"\uD83D`)
    expect(append(preview, String.raw`\uDE00\nsafe"}`).text).toContain('😀\nsafe')
  })

  it('scrubs registered literal values after JSON decoding', () => {
    const preview = new ArgumentPreview(['dummy-registered'])
    expect(finish(preview, String.raw`{"content":"dummy-\u0072egistered"}`).text).toContain(
      REDACTED_MARK,
    )
    expect(preview.snapshot().text).not.toContain('dummy-registered')
  })

  it('withholds registered multiline values while the string remains open', () => {
    const preview = new ArgumentPreview(['dummy-first\ndummy-second'])
    expect(append(preview, String.raw`{"content":"safe\ndummy-first\ndummy-`).text).not.toContain(
      'dummy-first',
    )
    const final = append(preview, 'second"}').text
    expect(final).toContain(REDACTED_MARK)
    expect(final).not.toContain('dummy-first')
    expect(final).not.toContain('dummy-second')
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
      const text = append(preview, fragment).text
      expect(text).not.toContain('dummy-body')
      expect(text).not.toContain('PRIVATE KEY')
    }
    expect(preview.snapshot().text).toContain('after')
  })

  it('bounds accumulated and final previews without clipping a credential into visible bytes', () => {
    const preview = new ArgumentPreview()
    const lead = String.raw`line\n`.repeat(TOOL_ARGUMENT_PREVIEW_MAX_CHARS / 2)
    const first = append(preview, `{"content":"${lead}`)
    expect(first.truncated).toBe(true)
    expect(first.text.length).toBeLessThanOrEqual(TOOL_ARGUMENT_PREVIEW_MAX_CHARS)
    expect(append(preview, 'tail'.repeat(TOOL_ARGUMENT_PREVIEW_MAX_CHARS))).toEqual(first)
    const credentialAtCap = JSON.stringify({
      content: 'a'.repeat(TOOL_ARGUMENT_PREVIEW_MAX_CHARS - 30) + `LLM_${'x'.repeat(100)}`,
    })
    const final = finish(preview, credentialAtCap)
    expect(final.truncated).toBe(true)
    expect(final.text).not.toContain('LLM_')
    expect(final.text.length).toBeLessThanOrEqual(TOOL_ARGUMENT_PREVIEW_MAX_CHARS)
  })

  it('uses done arguments authoritatively and ignores later deltas', () => {
    const preview = new ArgumentPreview()
    append(preview, '{"content":"stale')
    const done = finish(preview, '{"content":"authoritative"}')
    expect(done).toEqual({ text: '{"content":"authoritative"}', truncated: false })
    expect(append(preview, 'ignored')).toEqual(done)
  })

  it('holds incomplete escapes and refuses malformed strings without throwing', () => {
    const preview = new ArgumentPreview()
    expect(append(preview, String.raw`{"content":"one\n\u00`).text).toBe('{"content":"')
    expect(append(preview, '61\\n\\').text).toContain('one\n')
    expect(finish(new ArgumentPreview(), String.raw`{"content":"bad\q"}`).text).toBe('{"content":')
    expect(finish(new ArgumentPreview(), '{"content":"bad\n"}').text).toBe('{"content":')
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
