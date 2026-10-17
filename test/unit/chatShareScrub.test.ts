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
  it('treats regex metacharacters in roots, home and user names as literal text', () => {
    const name = 'Alice([a-z]+)+$^?{2}|[x].End'
    const literal = createChatSharePrivacy({
      workspaceRoots: [`C:/work/${name}`],
      home: `C:/Users/${name}`,
      userName: name,
      redactRegisteredSecrets: (text) => text,
    })
    expect(
      scrubShareText(`C:/work/${name}/src/main.ts C:/Users/${name}/data ${name}`, literal),
    ).toBe('src/main.ts [home]/data [user]')
    expect(scrubShareText(`C:/work/${name}/src/main.ts`.replaceAll('/', '\\'), literal)).toBe(
      'src/main.ts',
    )
    expect(scrubShareText('AliceaaaaEnd unrelated words', literal)).toBe(
      'AliceaaaaEnd unrelated words',
    )
  })
  it('redacts colon-prefixed private paths in both modes and every format', () => {
    for (const path of [
      'path:/srv/PrivateProject/config.json',
      String.raw`path:C:\PrivateProject\config.json`,
    ]) {
      for (const mode of ['full', 'conversation'] as const) {
        const doc = buildChatShare(
          {
            sessionId: 's1',
            title: 'Paths',
            exportedAt: '2026-10-05T12:00:00Z',
            items: [{ itemId: 'u1', kind: 'userMessage', status: 'completed', text: path }],
          },
          { target: 'chat', sessionId: 's1', mode, format: 'json', destination: 'copy' },
          privacy,
        )
        expect(doc.items[0]?.text).toContain('path:[path]')
        for (const format of ['md', 'html', 'json'] as const) {
          const bytes = renderChatShare(doc, format)
          expect(bytes).toContain('path:[path]')
          expect(bytes).not.toContain('PrivateProject')
        }
      }
    }
  })
  it('preserves division, slash commands, closing tags, URLs and regex literals in both modes and every format', () => {
    const corpus = [
      ['const ratio = 10 / 2;', 'const ratio = 10 / 2;'],
      ['Use /help to see commands.', 'Use /help to see commands.'],
      ['<section>Hello</section>', '&lt;section&gt;Hello&lt;/section&gt;'],
      [
        'https://example.com/a/b https://example.com',
        'https://example.com/a/b https://example.com',
      ],
      [
        String.raw`const matcher = /[a-z]+\/[0-9]+/g;`,
        String.raw`const matcher = /[a-z]+\/[0-9]+/g;`,
      ],
    ]
    for (const [input, html] of corpus) {
      for (const mode of ['full', 'conversation'] as const) {
        const doc = buildChatShare(
          {
            sessionId: 's1',
            title: 'Code',
            exportedAt: '2026-10-05T12:00:00Z',
            items: [{ itemId: 'a1', kind: 'agentMessage', status: 'completed', text: input }],
          },
          { target: 'chat', sessionId: 's1', mode, format: 'json', destination: 'copy' },
          privacy,
        )
        if (mode === 'conversation') expect(doc.items[0]?.text).toBe(input)
        else expect(doc.items[0]?.text).toContain(input!)
        expect(renderChatShare(doc, 'md')).toContain(input!)
        expect(renderChatShare(doc, 'html')).toContain(html!)
        expect(shareJsonSchema.parse(JSON.parse(renderChatShare(doc, 'json')))).toEqual(doc)
      }
    }
  })
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
      ['file:///private', '[path]'],
      ['file:///srv/Private%20Data/notes.txt', '[path]'],
      ['file:///C:/Users/Alice%20Example/work/src/a.ts', 'src/a.ts'],
      ['file://server/share/work/src/a.ts', 'src/a.ts'],
      ['/home/Alice Example/notes.txt', '[home]/notes.txt'],
      ['Alice Example wrote this', '[user] wrote this'],
      ['/srv/Private Data/notes.txt', '[path] Data/notes.txt'],
      [String.raw`Z:\Private Data\notes.txt`, String.raw`[path] Data\notes.txt`],
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
  it('recognizes path boundaries and preserves adjacent non-path tokens after a file URI', () => {
    for (const prefix of ['', ' ', '"', "'", '(', '[', '{', '=', 'path:']) {
      expect(scrubShareText(`${prefix}/srv/private.txt`, privacy)).toBe(`${prefix}[path]`)
      expect(scrubShareText(`${prefix}C:/PrivateProject/config.json`, privacy)).toBe(
        `${prefix}[path]`,
      )
    }
    const text = 'file:///private Use /private-command https://example.com/private'
    expect(scrubShareText(text, privacy)).toBe(
      '[path] Use /private-command https://example.com/private',
    )
    expect(
      scrubShareText(
        'identifier/srv/private.txt </srv/private.txt> /single / /srv/ file.txt',
        privacy,
      ),
    ).toBe('identifier/srv/private.txt </srv/private.txt> /single / /srv/ file.txt')
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
