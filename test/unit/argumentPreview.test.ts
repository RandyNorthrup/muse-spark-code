import { describe, expect, it } from 'vitest'
import { ArgumentPreview } from '../../src/core/backends/modelapi/argumentPreview'
import { agentEventSchema } from '../../src/shared/agentEvents'
import {
  REDACTED_MARK,
  TOOL_ARGUMENT_PREVIEW_MAX_CHARS,
  TOOL_ARGUMENT_PREVIEW_MAX_DEPTH,
} from '../../src/shared/constants'
import { toSnapshot, wireItemSchema } from '../../src/core/backends/musecode/sessionRecords'
import { toolDefinitions } from '../../src/core/backends/modelapi/tools'

function append(preview: ArgumentPreview, delta: string) {
  preview.append(delta)
  return preview.snapshot()
}

function finish(preview: ArgumentPreview, args: string) {
  preview.finish(args)
  return preview.snapshot()
}

import { ARGUMENT_PREVIEW_PROBES } from './helpers/argumentPreviewProbes'

describe('allowlist-only argument previews', () => {
  it('never shows a non-allowlisted field, including content and nested names', () => {
    const text = finish(
      new ArgumentPreview(['path']),
      JSON.stringify({
        path: 'visible.ts',
        content: 'dummy-secret',
        'dummy-key': { path: 'dummy-nested' },
      }),
    ).text
    expect(text).toContain('visible.ts')
    expect(text).toContain('…')
    expect(text).not.toContain('dummy')
    expect(text).not.toContain('content')
  })

  it('keeps nested field names structural even when their name is declared', () => {
    const args = '{"hidden":{"path":"dummy-secret"}}'
    expect(finish(new ArgumentPreview(['path']), args).text).toBe('…: …')
  })

  it('shows an allowlisted string only after its closing quote validates', () => {
    const preview = new ArgumentPreview(['path'])
    for (const delta of [
      '{"path":"first',
      String.raw`\nsecond`,
      String.raw`\uD83D`,
      String.raw`\uDE00`,
    ]) {
      const text = append(preview, delta).text
      expect(text).toContain('path')
      expect(text).not.toContain('first')
      expect(text).not.toContain('second')
    }
    expect(append(preview, '"}').text).toContain(String.raw`first\nsecond😀`)
  })

  it('scrubs a completed displayed string, including escaped credentials and PEM blocks', () => {
    const secret = `LLM_${'x'.repeat(24)}`
    const boundary = 'PRIVATE KEY'
    const value = `safe\n${secret}\nBearer\ndummy-token\n-----BEGIN ${boundary}-----\ndummy-body\n-----END ${boundary}-----\nafter`
    const preview = new ArgumentPreview(['command'])
    const args = JSON.stringify({ command: value }).replace('LLM_', String.raw`\u004cLM_`)
    for (const character of args) {
      const text = append(preview, character).text
      expect(text).not.toMatch(/LLM_|dummy-token|dummy-body|PRIVATE KEY/)
    }
    expect(preview.snapshot().text).toContain(REDACTED_MARK)
    expect(preview.snapshot().text).toContain('after')
  })

  it('scrubs overlapping registered literals longest first without exposing any suffix', () => {
    const literal = '9876543210'
    for (let split = 1; split < literal.length; split += 1) {
      const preview = new ArgumentPreview(['path'], [literal.slice(0, 4), literal, ''])
      expect(append(preview, '{"path":"' + literal.slice(0, split)).text).not.toMatch(/\d/)
      expect(append(preview, literal.slice(split) + '"}').text).toBe(`"path": "${REDACTED_MARK}"`)
    }
    const numeric = new ArgumentPreview([], [literal.slice(0, 4), literal])
    const numericArguments = '{"count":' + literal + '}'
    for (const character of numericArguments) {
      expect(append(numeric, character).text).not.toMatch(/\d/)
    }
  })

  it.each(ARGUMENT_PREVIEW_PROBES)(
    'withholds review probes at every UTF-8 boundary: %s',
    (args) => {
      const bytes = Buffer.from(args)
      for (let split = 0; split <= bytes.length; split += 1) {
        const preview = new ArgumentPreview(['path'])
        const decoder = new TextDecoder()
        const frames = [
          decoder.decode(bytes.subarray(0, split), { stream: true }),
          decoder.decode(bytes.subarray(split)),
        ]
        for (const frame of frames) {
          expect(append(preview, frame).text).not.toMatch(/dummy|private-name|9876543210/)
        }
        expect(finish(preview, args).text).not.toMatch(/dummy|private-name|9876543210/)
      }
      const preview = new ArgumentPreview(['path'])
      const decoder = new TextDecoder()
      for (const byte of bytes) {
        expect(
          append(preview, decoder.decode(Uint8Array.of(byte), { stream: true })).text,
        ).not.toMatch(/dummy|private-name|9876543210/)
      }
    },
  )

  it.each(['1', 'true', 'null', '[]', '{}', String.raw`"bad\q"`, '"bad\n"'])(
    'freezes an invalid allowlisted value (%s) until valid done arguments',
    (value) => {
      const preview = new ArgumentPreview(['path', 'command'])
      append(preview, '{"command":"safe",')
      append(preview, '"path":' + value)
      const frozen = preview.snapshot()
      expect(frozen.frozen).toBe(true)
      expect(append(preview, ',"command":"dummy-secret"}').text).toBe(frozen.text)
      expect(finish(preview, '{"path":"valid.ts"}')).toMatchObject({
        frozen: false,
        text: '"path": "valid.ts"',
      })
      expect(append(preview, 'ignored')).toEqual(preview.snapshot())
    },
  )

  it.each([
    '{"hidden":[0}',
    '{"hidden":{"x":0]',
    '{"hidden":[0]]',
    '{"hidden" "value"',
    '{"hidden" "',
    '{"hidden":[1,]',
    '{"hidden":{"a":1,}',
    '{"hidden":01,',
    '{"hidden":truth,',
    '{"hidden":1 2,',
    '{"hidden":false "path"',
    String.raw`{"hidden":"bad\q`,
    String.raw`{"hidden":"bad\u00z`,
    '{"hidden":"bad\n',
    '[',
    '1',
    '{}[',
  ])('freezes malformed streaming tokens before reading any later field: %s', (prefix) => {
    const preview = new ArgumentPreview(['path'])
    const safe = append(preview, prefix)
    expect(safe.frozen).toBe(true)
    expect(append(preview, ',"path":"dummy-secret"}').text).toBe(safe.text)
  })

  it('freezes on duplicate decoded keys, including nested keys and escaped aliases', () => {
    for (const args of [
      String.raw`{"path":"safe","\u0070ath":"dummy-secret"}`,
      '{"hidden":{"x":1,"x":2},"path":"dummy-secret"}',
    ]) {
      const preview = new ArgumentPreview(['path'])
      const result = finish(preview, args)
      expect(result.frozen).toBe(true)
      expect(result.text).not.toContain('dummy-secret')
    }
  })

  it('freezes past the named nesting bound and after a malformed closer', () => {
    const preview = new ArgumentPreview(['path'])
    append(preview, '{"path":"safe","hidden":' + '['.repeat(TOOL_ARGUMENT_PREVIEW_MAX_DEPTH))
    const frozen = preview.snapshot()
    expect(frozen.frozen).toBe(true)
    expect(
      append(preview, ']'.repeat(TOOL_ARGUMENT_PREVIEW_MAX_DEPTH) + ',"path":"dummy"}').text,
    ).toBe(frozen.text)
    const malformed = new ArgumentPreview(['path', 'command'])
    append(malformed, '{"path":"safe","hidden":[0}')
    const safe = malformed.snapshot()
    expect(safe.frozen).toBe(true)
    expect(append(malformed, ',"command":"dummy"}').text).toBe(safe.text)
  })

  it('keeps aborted or malformed done strings private and ignores late deltas', () => {
    const preview = new ArgumentPreview(['path'])
    const partial = append(preview, '{"path":"dummy-secret')
    expect(partial.text).not.toContain('dummy')
    expect(finish(preview, '{"path":"dummy-secret')).toMatchObject({
      text: partial.text,
      frozen: true,
    })
    expect(append(preview, '"}').text).toBe(partial.text)
  })

  it('uses the latest validated done payload authoritatively, while ignoring late deltas', () => {
    const preview = new ArgumentPreview(['path'])
    append(preview, '{"path":"stale')
    expect(finish(preview, '{"path":"first.ts"}').text).toContain('first.ts')
    expect(finish(preview, '{"path":"final.ts"}').text).toBe('"path": "final.ts"')
    const final = preview.snapshot()
    expect(append(preview, 'ignored')).toEqual(final)
  })

  it('bounds retention while continuing the byte count, including UTF-8', () => {
    const preview = new ArgumentPreview(['path'])
    const prefix = '{"path":"' + 'é'.repeat(TOOL_ARGUMENT_PREVIEW_MAX_CHARS)
    const first = append(preview, prefix)
    expect(first.truncated).toBe(true)
    expect(first.text).not.toContain('é')
    const next = append(preview, 'tail'.repeat(TOOL_ARGUMENT_PREVIEW_MAX_CHARS))
    expect(next.text).toBe(first.text)
    expect(next.bytes).toBe(Buffer.byteLength(prefix) + TOOL_ARGUMENT_PREVIEW_MAX_CHARS * 4)
    expect(next.text.length).toBeLessThanOrEqual(TOOL_ARGUMENT_PREVIEW_MAX_CHARS)
  })

  it('declares command/path/pattern/url previews locally; tools without declarations show bytes only', () => {
    const definitions = toolDefinitions('linux', {
      hasShell: true,
      hasSkills: true,
      hasWebFetch: true,
    })
    for (const [name, field] of [
      ['bash', 'command'],
      ['write_file', 'path'],
      ['read_file', 'path'],
      ['edit_file', 'path'],
      ['search', 'pattern'],
      ['web_fetch', 'url'],
    ]) {
      const definition = definitions.find((tool) => tool.name === name)
      expect(definition?.previewFields).toEqual([field])
      expect(JSON.stringify(definition)).not.toContain('previewFields')
      expect(
        finish(
          new ArgumentPreview(definition?.previewFields),
          JSON.stringify({ [field!]: 'visible' }),
        ).text,
      ).toContain('visible')
    }
    expect(definitions.find((tool) => tool.name === 'ask_user')?.previewFields).toBeUndefined()
    const args = '{"command":"dummy-secret","password":"dummy-hidden"}'
    expect(finish(new ArgumentPreview(), args)).toMatchObject({
      text: '',
      bytes: Buffer.byteLength(args),
    })
  })

  it('never discloses secrets in random non-allowlisted JSON positions and byte splits', () => {
    let seed = 106
    const random = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0
      return seed / 2 ** 32
    }
    const secret = 'canary-☃-😀-private'
    const json = (depth: number): unknown => {
      switch (Math.floor(random() * (depth === 0 ? 4 : 6))) {
        case 0: {
          return secret
        }
        case 1: {
          return Math.floor(random() * 100)
        }
        case 2: {
          return random() > 0.5
        }
        case 3: {
          return null
        }
        case 4: {
          return [json(depth - 1), { path: secret }]
        }
        default: {
          return { [secret]: json(depth - 1), path: secret }
        }
      }
    }
    for (let sample = 0; sample < 100; sample += 1) {
      const args = JSON.stringify({
        path: 'safe.ts',
        [secret]: json(4),
        content: [secret, json(4)],
      })
      const bytes = Buffer.from(args)
      const decoder = new TextDecoder()
      const preview = new ArgumentPreview(['path'])
      let at = 0
      while (at < bytes.length) {
        const end = Math.min(bytes.length, at + 1 + Math.floor(random() * 13))
        const snapshot = append(preview, decoder.decode(bytes.subarray(at, end), { stream: true }))
        expect(snapshot.text).not.toContain(secret)
        expect(snapshot.text).not.toContain('private')
        at = end
      }
      append(preview, decoder.decode())
      expect(preview.snapshot()).toMatchObject({ frozen: false, bytes: bytes.length })
      expect(preview.snapshot().text).toContain('safe.ts')
    }
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
    for (const invalid of [{ bytes: -1 }, { bytes: 1.5 }, { bytes: '1' }, { frozen: 'yes' }]) {
      expect(
        agentEventSchema.safeParse({
          type: 'toolArgumentPreview',
          item: { ...item, argumentPreview: { ...item.argumentPreview, ...invalid } },
        }).success,
      ).toBe(false)
    }
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
