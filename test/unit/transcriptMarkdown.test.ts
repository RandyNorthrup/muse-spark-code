import { describe, expect, it } from 'vitest'
import {
  exportFileName,
  renderTranscriptMarkdown,
  type TranscriptExport,
} from '../../src/core/export/transcriptMarkdown'
import type { ItemSnapshot } from '../../src/shared/agentEvents'
import { EN } from '../../src/shared/l10n/en'
import { forms } from '../../src/shared/l10n/forms'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'

function item(overrides: Partial<ItemSnapshot> & Pick<ItemSnapshot, 'kind'>): ItemSnapshot {
  return { itemId: `${overrides.kind}-1`, status: 'completed', ...overrides }
}

function render(items: readonly ItemSnapshot[]): string {
  const input: TranscriptExport = {
    title: 'Fix the tests',
    sessionId: 's1',
    backendLabel: 'Muse Code',
    modelId: 'muse-spark-1.3',
    exportedAt: '2026-09-24T12:00:00.000Z',
    items,
  }
  return renderTranscriptMarkdown(input)
}

describe('renderTranscriptMarkdown', () => {
  it('heads the file with the conversation facts', () => {
    expect(render([])).toBe(
      [
        '# Fix the tests',
        '',
        '- Session: `s1`',
        '- Backend: Muse Code',
        '- Model: muse-spark-1.3',
        '- Exported: 2026-09-24T12:00:00.000Z',
        '',
        '---',
        '',
      ].join('\n'),
    )
  })

  it('writes messages, thinking, tools, shell commands and subagents in order', () => {
    const markdown = render([
      item({
        kind: 'userMessage',
        text: 'Why does it fail?',
        attachments: [{ type: 'image', mediaType: 'image/png' }],
      }),
      item({ kind: 'reasoning', summary: ['Look at the test.', 'Then the code.'] }),
      item({ kind: 'reasoning', text: 'raw\n\nthoughts' }),
      item({ kind: 'reasoning' }),
      item({ kind: 'agentMessage', text: 'It fails because **x**.' }),
      item({ kind: 'agentMessage', text: '' }),
      item({
        kind: 'toolCall',
        tool: 'edit_file',
        args: '{"path":"a.ts","old":"x"}',
        visibleOutput: 'ok',
        patchSummary: { files: 1, added: 3, removed: 1 },
      }),
      item({
        kind: 'toolCall',
        tool: 'bash',
        args: 'not json',
        status: 'failed',
        failureReason: 'exit 1',
      }),
      item({ kind: 'toolCall', outputRef: { id: 'o1', byteLen: 5000 } }),
      item({ kind: 'userShell', args: 'npm test', visibleOutput: 'passed' }),
      item({
        kind: 'subagent',
        role: 'explorer',
        objective: 'Find the tests',
        result: { summary: 'Found 3', text: 'Found 3 tests\nin src' },
      }),
      item({ kind: 'subagent', status: 'running' }),
      item({ kind: 'subagent', result: { summary: 'Only a summary' } }),
      item({ kind: 'compaction', fallbackText: 'Context compacted' }),
      item({ kind: 'workflow' }),
      item({ kind: 'reminderChild', text: 'hidden' }),
    ])
    const sections = markdown.split('\n\n---\n\n', 2)[1]
    expect(sections).toBe(
      [
        '## You\n\nWhy does it fail?\n\n_1 image attached._',
        '### Thinking\n\n> Look at the test.\n>\n> Then the code.',
        '### Thinking\n\n> raw\n>\n> thoughts',
        '## Muse\n\nIt fails because **x**.',
        '### Tool: edit_file\n\nArguments:\n\n```json\n{\n  "path": "a.ts",\n  "old": "x"\n}\n```\n\nOutput:\n\n```\nok\n```\n\n_Changed 1 file: +3 −1._',
        '### Tool: bash (failed)\n\nArguments:\n\n```\nnot json\n```\n\n_Failed: exit 1_',
        // Counts in the display language's digits and grouping (PLAN.md D33).
        '### Tool: tool\n\n_The output (5,000 bytes) is stored by the backend and not included._',
        '### Shell command\n\nArguments:\n\n```\nnpm test\n```\n\nOutput:\n\n```\npassed\n```',
        '### Subagent: explorer\n\nFind the tests\n\n> Found 3 tests\n> in src',
        '### Subagent: agent (running)',
        '### Subagent: agent\n\n> Only a summary',
        '_Context compacted_',
        '_workflow_',
      ].join('\n\n') + '\n',
    )
  })

  it('counts several images and several changed files', () => {
    const markdown = render([
      item({
        kind: 'userMessage',
        attachments: [
          { type: 'image', mediaType: 'a' },
          { type: 'image', mediaType: 'b' },
        ],
      }),
      item({ kind: 'toolCall', tool: 'write', patchSummary: { files: 2, added: 0, removed: 0 } }),
    ])
    expect(markdown).toContain('## You\n\n\n\n_2 images attached._')
    expect(markdown).toContain('_Changed 2 files: +0 −0._')
  })

  it('writes its own words in the display language and leaves the conversation as it was (D33)', () => {
    setUiText(
      {
        ...EN,
        exportUserHeading: 'Du',
        exportToolHeading: 'Werkzeug: {tool}',
        exportImagesAttached: forms({
          one: '{count} Bild angehängt.',
          other: '{count} Bilder angehängt.',
        }),
        exportOutputStored: forms({
          one: 'Die Ausgabe ({count} Byte) liegt beim Backend.',
          other: 'Die Ausgabe ({count} Bytes) liegt beim Backend.',
        }),
      },
      'de',
    )
    try {
      const markdown = render([
        item({
          kind: 'userMessage',
          text: 'Why does it fail?',
          attachments: [{ type: 'image', mediaType: 'image/png' }],
        }),
        item({ kind: 'toolCall', tool: 'read_file', outputRef: { id: 'o1', byteLen: 5000 } }),
      ])
      expect(markdown).toContain('## Du\n\nWhy does it fail?\n\n_1 Bild angehängt._')
      expect(markdown).toContain('### Werkzeug: read_file\n\n_Die Ausgabe (5.000 Bytes)')
    } finally {
      setUiText(EN, BASE_LOCALE)
    }
  })

  it('fences output longer than any backtick run inside it', () => {
    const markdown = render([item({ kind: 'toolCall', tool: 't', visibleOutput: 'a ```` b ` c' })])
    expect(markdown).toContain('`````\na ```` b ` c\n`````')
  })
})

describe('exportFileName', () => {
  const day = new Date('2026-09-24T23:30:00Z')

  it('keeps the title’s words, safe for any file system', () => {
    expect(exportFileName('Fix the tests!', day, 'md')).toBe('muse-fix-the-tests-2026-09-24.md')
    expect(exportFileName(String.raw`  C:\path/to "x"  `, day, 'json')).toBe(
      'muse-c-path-to-x-2026-09-24.json',
    )
  })

  it('falls back to "conversation" and bounds a long title', () => {
    expect(exportFileName('!!!', day, 'md')).toBe('muse-conversation-2026-09-24.md')
    const long = exportFileName(`${'word '.repeat(30)}end`, day, 'md')
    expect(long.length).toBeLessThanOrEqual('muse-'.length + 60 + '-2026-09-24.md'.length)
    // A cut that lands on a separator leaves no double dash before the date.
    expect(long).not.toContain('--')
  })
})

describe('renderTranscriptMarkdown: cited sources (M33)', () => {
  it('lists a reply’s sources as links, their titles escaped and their URLs kept whole', () => {
    const markdown = render([
      item({
        kind: 'agentMessage',
        text: 'Vite 7 shipped.',
        citations: [
          { url: 'https://vite.dev/blog', title: 'Vite [7] is out' },
          { url: 'https://example.com/a (b)' },
        ],
      }),
    ])
    expect(markdown).toContain(
      [
        '## Muse',
        '',
        'Vite 7 shipped.',
        '',
        'Sources:',
        '',
        String.raw`- [Vite \[7\] is out](<https://vite.dev/blog>)`,
        '- [https://example.com/a (b)](<https://example.com/a (b)>)',
      ].join('\n'),
    )
  })
})
