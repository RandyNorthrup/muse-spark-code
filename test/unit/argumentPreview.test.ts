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

  it.each([
    String.raw`{"password":{"private-name":"dummy-first\ndummy-second"},"content":"visible"}`,
    String.raw`{"password":["dummy-first\ndummy-second"],"content":"visible"}`,
    String.raw`{"\u0070assword":{"private-name":{"nested-private":["dummy-first\ndummy-second"]}},"content":"visible"}`,
    String.raw`{"PASSWORD":[[{"private-name":"dummy-first\ndummy-second"}]],"content":"visible"}`,
    String.raw`{"outer":[{"api-key":{"private-name":[{"nested-private":"dummy-first\ndummy-second"}]}}],"content":"visible"}`,
    String.raw`{"ｐａｓｓｗｏｒｄ":{"private-name":["dummy-first\ndummy-second"]},"content":"visible"}`,
  ])('inherits whole-value sensitivity at every byte boundary: %s', (args) => {
    const bytes = Buffer.from(args)
    for (let split = 0; split <= bytes.length; split += 1) {
      const preview = new ArgumentPreview()
      const decoder = new TextDecoder()
      for (const frame of [
        decoder.decode(bytes.subarray(0, split), { stream: true }),
        decoder.decode(bytes.subarray(split)),
      ]) {
        expect(append(preview, frame).text).not.toMatch(/dummy|private-name|nested-private/)
      }
      const final = finish(preview, args).text
      expect(final).not.toMatch(/dummy|private-name|nested-private/)
      expect(final).toContain(REDACTED_MARK)
      expect(final).toContain('visible')
    }
    const preview = new ArgumentPreview()
    const decoder = new TextDecoder()
    for (const byte of bytes) {
      expect(
        append(preview, decoder.decode(Uint8Array.of(byte), { stream: true })).text,
      ).not.toMatch(/dummy|private-name|nested-private/)
    }
    expect(append(preview, decoder.decode()).text).toContain('visible')
  })

  it.each(['9876543210', 'true', 'false', 'null'])(
    'withholds a sensitive scalar from its first byte until close: %s',
    (value) => {
      const preview = new ArgumentPreview()
      append(preview, '{"password":')
      for (const character of value) {
        expect(append(preview, character).text).toBe(`{"password":"${REDACTED_MARK}"`)
      }
      expect(append(preview, ',"content":"visible"}').text).toContain('visible')
    },
  )

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

  it('withholds registered numeric prefixes at every split until redaction', () => {
    const literal = '9876543210'
    for (let split = 1; split < literal.length; split += 1) {
      const preview = new ArgumentPreview([literal, '9876'])
      expect(append(preview, '{"count":' + literal.slice(0, split)).text).not.toContain('9')
      const final = append(preview, literal.slice(split) + '}').text
      expect(final).toBe(`{"count":${REDACTED_MARK}}`)
    }
  })

  it('releases a registered prefix when disambiguated or the value closes', () => {
    const preview = new ArgumentPreview(['9876543210', '9876', ''])
    expect(append(preview, '{"count":987').text).toBe('{"count":')
    expect(append(preview, '0').text).toBe('{"count":9870')
    const closed = new ArgumentPreview(['9876543210'])
    expect(append(closed, '{"count":987').text).toBe('{"count":')
    expect(append(closed, '}').text).toBe('{"count":987}')
    expect(finish(preview, '{"count":987}').text).toBe('{"count":987}')
    expect(finish(preview, '987').text).toBe('987')
  })

  it('holds registered prefixes through incomplete or truncated done values', () => {
    const literal = '9876543210'
    expect(finish(new ArgumentPreview([literal]), '{"count":987').text).toBe('{"count":')
    const lead = '{"padding":"'
    const field = '","count":'
    const partial = '987'
    const prefix =
      lead +
      'x'.repeat(TOOL_ARGUMENT_PREVIEW_MAX_CHARS - lead.length - field.length - partial.length) +
      field
    const bounded = finish(new ArgumentPreview([literal]), prefix + literal + '}')
    expect(bounded.truncated).toBe(true)
    expect(bounded.text).toBe(prefix)
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
