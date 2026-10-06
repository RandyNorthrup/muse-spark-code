import { describe, expect, it } from 'vitest'
import { buildChatShare, renderChatShare } from '../../src/core/sharing/chatShare'
import { createChatSharePrivacy } from '../../src/core/sharing/privacy'
import { shareJsonSchema, scrubShareText } from '../../src/shared/share'

const context = {
  workspaceRoots: [
    '/home/Alice Example/work',
    String.raw`C:\Users\Alice Example\work`,
    String.raw`\\server\share\work`,
  ],
  home: '/home/Alice Example',
  userName: 'Alice Example',
  redactRegisteredSecrets: (text: string) => text.replaceAll('registered-value', '[redacted]'),
}
const privacy = createChatSharePrivacy(context)

describe('M118 always-on scrub', () => {
  it('normalises workspace, home, user, drive, UNC, file URI and escaped separators with spaces', () => {
    const cases = [
      ['/home/Alice Example/work/src/a.ts', 'src/a.ts'],
      [String.raw`C:\Users\Alice Example\work\src\a.ts`, 'src/a.ts'],
      [String.raw`c:\\users\\ALICE EXAMPLE\\work\\src\\a.ts`, 'src/a.ts'],
      [String.raw`\\server\share\work\src\a.ts`, 'src/a.ts'],
      ['file:///home/Alice%20Example/work/src/a.ts', 'src/a.ts'],
      ['file://localhost/home/Alice%20Example/work/src/a.ts', 'src/a.ts'],
      ['file://LOCALHOST/C:/Users/Alice%20Example/work/src/a.ts', 'src/a.ts'],
      [String.raw`\/home\/Alice Example\/work\/src\/a.ts`, 'src/a.ts'],
      ['file:///home/Alice Example/work/src/a.ts', 'src/a.ts'],
      ['file:///srv/%broken/private.txt', '[path]'],
      ['file:///C:/Users/Alice%20Example/work/src/a.ts', 'src/a.ts'],
      ['file://server/share/work/src/a.ts', 'src/a.ts'],
      ['/home/Alice Example/notes.txt', '[home]/notes.txt'],
      ['Alice Example wrote this', '[user] wrote this'],
      ['/srv/Private Data/notes.txt', '[path]'],
      [String.raw`Z:\Private Data\notes.txt`, '[path]'],
      [String.raw`\\other\private\notes.txt`, '[path]'],
    ]
    for (const [input, output] of cases) expect(scrubShareText(input!, privacy), input).toBe(output)
  })
  it('preserves relative paths, URLs, Markdown escapes and code backslashes', () => {
    const text = String.raw`src/a.ts https://example.com/a \*literal\* const newline = '\n'`
    expect(scrubShareText(text, privacy)).toBe(text)
    expect(scrubShareText('malAlice Examplexyz', privacy)).toBe('malAlice Examplexyz')
    expect(scrubShareText('/home/Alice Example/workshop/private.txt', privacy)).toBe(
      '[home]/workshop/private.txt',
    )
    expect(scrubShareText('/home/Alice Example/work-neighbour/private.txt', privacy)).toBe(
      '[home]/work-neighbour/private.txt',
    )
  })
  it('does not treat empty or filesystem-only roots as a wildcard', () => {
    const emptyRoot = createChatSharePrivacy({ ...context, workspaceRoots: ['/', ''] })
    expect(scrubShareText('Plain message', emptyRoot)).toBe('Plain message')
    expect(scrubShareText('/srv/private', emptyRoot)).toBe('[path]')
  })
  it('scrubs every portable string in every format, including ids, names and chosen content', () => {
    const key = `LLM_${'K'.repeat(20)}`
    const text = `${key} registered-value ${'a'.repeat(64)} alice@example.com Alice Example /home/Alice Example/work/src/a.ts`
    const source = {
      sessionId: 's1',
      title: text,
      exportedAt: '2026-10-05T12:00:00Z',
      items: [
        { itemId: 'registered-value', kind: 'userMessage', status: 'completed', text },
        { itemId: key, kind: 'agentMessage', status: 'completed', text },
      ],
      attachments: [
        { messageId: 'registered-value', id: 'registered-value-file', name: text, content: text },
      ],
    }
    for (const mode of ['full', 'conversation'] as const) {
      const doc = buildChatShare(
        source,
        {
          target: 'chat',
          sessionId: 's1',
          mode,
          format: 'json',
          destination: 'copy',
          range: { from: 'registered-value', to: key },
          options: { attachmentContents: ['registered-value-file'] },
        },
        privacy,
      )
      expect(doc.range?.from).toBe(doc.items[0]?.id)
      expect(doc.range?.to).toBe(doc.items[1]?.id)
      expect(doc.items[0]?.id).not.toBe(doc.items[1]?.id)
      expect(doc.options.attachmentContents[0]).toBe(doc.items[0]?.attachments?.[0]?.id)
      for (const format of ['md', 'html', 'json'] as const) {
        const bytes = renderChatShare(doc, format)
        for (const privateText of [
          key,
          'registered-value',
          'a'.repeat(64),
          'alice@example.com',
          'Alice Example',
          '/home/',
        ])
          expect(bytes).not.toContain(privateText)
        expect(bytes).toContain('[redacted]')
      }
      expect(shareJsonSchema.safeParse(JSON.parse(renderChatShare(doc, 'json'))).success).toBe(true)
    }
  })
  it('scrubs registered values before a workspace path can change their representation', () => {
    const raw = '/home/Alice Example/work/private'
    const registered = createChatSharePrivacy({
      ...context,
      redactRegisteredSecrets: (text) =>
        text.replaceAll('home/Alice Example/work/private', '[redacted]'),
    })
    expect(scrubShareText(raw, registered)).toContain('[redacted]')
  })
  it('scrubs registered values and M84 identifiers exposed by decoding a local file URI', () => {
    expect(scrubShareText('file:///home/Alice%20Example/work/%72egistered-value', privacy)).toBe(
      '[redacted]',
    )
    const digest = '%61'.repeat(64)
    expect(scrubShareText(`file:///home/Alice%20Example/work/${digest}`, privacy)).toBe(
      '[redacted]',
    )
    expect(scrubShareText('file:///home/Alice%20Example/work/alice%40example.com', privacy)).toBe(
      '[redacted account]',
    )
  })
  it('uses current registered values, with shared detection before and after path normalisation', () => {
    let value = 'first'
    const dynamic = createChatSharePrivacy({
      ...context,
      redactRegisteredSecrets: (text) => text.replaceAll(value, '[redacted]'),
    })
    expect(scrubShareText('first second', dynamic)).toBe('[redacted] second')
    value = 'second'
    expect(scrubShareText('first second', dynamic)).toBe('first [redacted]')
  })
})
