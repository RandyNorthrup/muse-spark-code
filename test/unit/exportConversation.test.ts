import { describe, expect, it } from 'vitest'
import type { BackendKind, SessionHistoryOutcome } from '../../src/core/agent/agentBackend'
import { parseSessionExport } from '../../src/core/export/sessionTransfer'
import {
  type ConversationExports,
  exportConversation,
  type ExportPreview,
  type ExportPreviewChoice,
} from '../../src/host/conversation/exportConversation'
import type { ItemSnapshot } from '../../src/shared/agentEvents'
import { CONVERSATION_MODEL_TEXT, SESSION_EXPORT_MAX_ITEMS } from '../../src/shared/constants'

function fakes(
  kind: BackendKind,
  history: Partial<SessionHistoryOutcome>,
  preview: ExportPreviewChoice = 'redacted',
) {
  let reads = 0
  const markdown: [string, string][] = []
  const logs: [string, string][] = []
  const json: [string, string][] = []
  const previews: ExportPreview[] = []
  // What happened, in order: the preview must come before any write.
  const events: string[] = []
  const host = {
    info: {
      kind,
      serverName: 'fake',
      serverVersion: '0',
      grantedCapabilities: [],
      canEditSessions: true,
    },
    readSession: (): Promise<SessionHistoryOutcome> => {
      reads += 1
      return Promise.resolve({ mode: 'inline', items: [], name: undefined, todos: [], ...history })
    },
  }
  const session = { sessionId: 's1', modelId: 'muse-spark-1.3' }
  const exports: ConversationExports = {
    saveMarkdown: (fileName: string, content: string) => {
      markdown.push([fileName, content])
      return Promise.resolve()
    },
    saveSessionLog: (sessionId: string, fileName: string) => {
      logs.push([sessionId, fileName])
      return Promise.resolve()
    },
    saveJson: (fileName: string, content: string) => {
      events.push('save')
      json.push([fileName, content])
      return Promise.resolve()
    },
    previewExport: (shown: ExportPreview) => {
      events.push('preview')
      previews.push(shown)
      return Promise.resolve(preview)
    },
    localRoots: () => [String.raw`C:\Users\Randy Northrup`],
  }
  return { host, session, exports, markdown, logs, json, previews, events, reads: () => reads }
}

const NOW = new Date('2026-09-24T12:00:00Z')

function userItem(text: string): ItemSnapshot {
  return { itemId: 'u', kind: 'userMessage', status: 'completed', text }
}

describe('exportConversation', () => {
  it('redacts accepted prompt secrets from Markdown content and filenames on either backend (RVM92E P1)', async () => {
    const secret = `mgst_${'A'.repeat(42)}A`
    for (const kind of ['museCode', 'modelApi'] as const) {
      const t = fakes(kind, { items: [userItem(`use ${secret}`)] })
      expect(await exportConversation(t.host, t.session, 'markdown', NOW, t.exports)).toBe(
        'exported',
      )
      expect(JSON.stringify(t.markdown).includes(secret)).toBe(false)
      expect(t.markdown[0]?.[0]).toBe('muse-use-redacted-2026-09-24.md')
      expect(t.markdown[0]?.[1]).toContain('use [redacted]')
    }
  })

  it('refuses the session log on the Model API backend without reading anything', async () => {
    const t = fakes('modelApi', {})
    expect(await exportConversation(t.host, t.session, 'sessionLog', NOW, t.exports)).toBe(
      'logUnavailable',
    )
    expect(t.reads()).toBe(0)
    expect(t.logs).toEqual([])
  })

  it('titles an unnamed conversation by its first prompt, else generically', async () => {
    const prompted = fakes('modelApi', {
      name: '  ',
      items: [userItem('  Refactor auth\nand tests')],
    })
    expect(
      await exportConversation(prompted.host, prompted.session, 'markdown', NOW, prompted.exports),
    ).toBe('exported')
    const [fileName, content] = prompted.markdown[0]!
    expect(fileName).toBe('muse-refactor-auth-2026-09-24.md')
    expect(content).toContain('# Refactor auth')
    expect(content).toContain('- Backend: Meta Model API (your key, pay as you go)')
    const untitled = fakes('museCode', {
      items: [{ itemId: 'm', kind: 'agentMessage', status: 'completed', text: 'Hello' }],
    })
    await exportConversation(untitled.host, untitled.session, 'markdown', NOW, untitled.exports)
    expect(untitled.markdown[0]?.[0]).toBe('muse-muse-conversation-2026-09-24.md')
    expect(untitled.markdown[0]?.[1]).toContain('- Backend: Muse Code (your Muse subscription)')
  })

  it('previews the redacted file before writing it, on either backend', async () => {
    for (const kind of ['modelApi', 'museCode'] as const) {
      const t = fakes(kind, {
        name: 'Share me',
        items: [
          userItem(String.raw`Read C:\Users\Randy Northrup\notes.md and /home/alice/x.md`),
          { itemId: 'a', kind: 'agentMessage', status: 'completed', text: 'Mail bob@example.com' },
        ],
      })
      expect(await exportConversation(t.host, t.session, 'json', NOW, t.exports)).toBe('exported')
      expect(t.events).toEqual(['preview', 'save'])
      const [shown] = t.previews
      expect(shown?.fileName).toBe('muse-share-me-2026-09-24.json')
      expect(shown?.detail.split('\n')).toEqual([
        'The redacted file is open in the editor. Nothing is written until you choose.',
        '2 messages in this conversation',
        '2 paths redacted',
        '1 account id redacted',
        '0 credentials or key digests removed',
        'Known credential shapes (API keys, tokens, passwords, private keys) and the key digest are always removed. A secret in another shape stays: read the file before you share it.',
      ])
      // The preview is the file that is written, byte for byte.
      expect(t.json).toEqual([['muse-share-me-2026-09-24.json', shown?.content]])
      const parsed = parseSessionExport(JSON.parse(shown?.content ?? ''))
      expect(parsed.ok && parsed.doc.transcript[0]?.text).toBe(
        `Read ${CONVERSATION_MODEL_TEXT.exportRedactedPath} and ${CONVERSATION_MODEL_TEXT.exportRedactedPath}`,
      )
      expect(parsed.ok && parsed.doc.sourceBackend).toBe(kind)
      expect(shown?.content).not.toContain('Northrup')
    }
  })

  it('writes the full file only when the preview asks for it, and nothing when dismissed', async () => {
    const history = { items: [userItem('Read /home/alice/notes.md')] }
    const full = fakes('modelApi', history, 'full')
    expect(await exportConversation(full.host, full.session, 'json', NOW, full.exports)).toBe(
      'exported',
    )
    expect(full.events).toEqual(['preview', 'save'])
    expect(full.previews[0]?.content).not.toContain('/home/alice')
    const written = parseSessionExport(JSON.parse(full.json[0]?.[1] ?? ''))
    expect(written.ok && written.doc.transcript[0]?.text).toBe('Read /home/alice/notes.md')
    expect(written.ok && written.doc.redacted).toBe(false)
    const dismissed = fakes('modelApi', history, 'dismissed')
    expect(
      await exportConversation(dismissed.host, dismissed.session, 'json', NOW, dismissed.exports),
    ).toBe('dismissed')
    expect(dismissed.events).toEqual(['preview'])
  })

  it('writes no JSON for withheld or empty history, or too many items', async () => {
    const withheld = fakes('museCode', { mode: 'none' })
    expect(
      await exportConversation(withheld.host, withheld.session, 'json', NOW, withheld.exports),
    ).toBe('historyUnavailable')
    const empty = fakes('modelApi', {})
    expect(await exportConversation(empty.host, empty.session, 'json', NOW, empty.exports)).toBe(
      'empty',
    )
    const many = fakes('modelApi', {
      items: Array.from({ length: SESSION_EXPORT_MAX_ITEMS + 1 }, () => userItem('x')),
    })
    expect(await exportConversation(many.host, many.session, 'json', NOW, many.exports)).toBe(
      'tooLarge',
    )
    for (const t of [withheld, empty, many]) expect(t.json).toEqual([])
    expect(many.events).toEqual([])
  })

  it('writes no JSON for a message past the import byte limit', async () => {
    const huge = fakes('modelApi', { items: [userItem('ab '.repeat(6 * 1024 * 1024))] })
    expect(await exportConversation(huge.host, huge.session, 'json', NOW, huge.exports)).toBe(
      'tooLarge',
    )
    expect(huge.json).toEqual([])
  })

  it('refuses a full file past the import byte limit after previewing its redacted form', async () => {
    // Redacted it fits; in full it would not, so the full file is refused after the preview.
    const longPath = `/${'ab/'.repeat(330)}c`
    const paths = fakes(
      'modelApi',
      { items: [userItem(Array.from({ length: 17_500 }, () => longPath).join(' '))] },
      'full',
    )
    expect(await exportConversation(paths.host, paths.session, 'json', NOW, paths.exports)).toBe(
      'tooLarge',
    )
    expect(paths.json).toEqual([])
    expect(paths.events).toEqual(['preview'])
  })

  it('writes no header-only file: history Muse Code withheld, or nothing said yet', async () => {
    const withheld = fakes('museCode', { mode: 'none' })
    expect(
      await exportConversation(withheld.host, withheld.session, 'markdown', NOW, withheld.exports),
    ).toBe('historyUnavailable')
    expect(withheld.markdown).toEqual([])
    // The session log still has the whole record.
    expect(
      await exportConversation(
        withheld.host,
        withheld.session,
        'sessionLog',
        NOW,
        withheld.exports,
      ),
    ).toBe('exported')
    expect(withheld.logs).toEqual([['s1', 'muse-muse-conversation-2026-09-24.json']])
    const empty = fakes('modelApi', {})
    expect(
      await exportConversation(empty.host, empty.session, 'markdown', NOW, empty.exports),
    ).toBe('empty')
    expect(empty.markdown).toEqual([])
  })
})
