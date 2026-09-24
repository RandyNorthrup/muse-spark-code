import { describe, expect, it } from 'vitest'
import type { BackendKind, SessionHistoryOutcome } from '../../src/core/agent/agentBackend'
import { exportConversation } from '../../src/host/conversation/exportConversation'

function fakes(kind: BackendKind, history: Partial<SessionHistoryOutcome>) {
  let reads = 0
  const markdown: [string, string][] = []
  const logs: [string, string][] = []
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
  const exports = {
    saveMarkdown: (fileName: string, content: string) => {
      markdown.push([fileName, content])
      return Promise.resolve()
    },
    saveSessionLog: (sessionId: string, fileName: string) => {
      logs.push([sessionId, fileName])
      return Promise.resolve()
    },
  }
  return { host, session, exports, markdown, logs, reads: () => reads }
}

const NOW = new Date('2026-09-24T12:00:00Z')

describe('exportConversation', () => {
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
      items: [
        {
          itemId: 'u',
          kind: 'userMessage',
          status: 'completed',
          text: '  Refactor auth\nand tests',
        },
      ],
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
