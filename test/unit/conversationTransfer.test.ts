// The conversation's session-transfer bundle (CONVBUDGET, PLAN.md D6): the
// entry answers the import flow over a document the real exporter built, in
// the caller's language, and every flow the controller loads on first use is
// a function. The export flow keeps its own suites through the moved modules
// (sessionTransfer, transcriptMarkdown, sessionImport); this suite holds the
// entry to its lazy contract.
import { describe, expect, it } from 'vitest'
import type { ItemSnapshot } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import {
  buildSessionExport,
  messageCount,
  type SessionExportSource,
} from '../../src/core/export/sessionTransfer'
import * as entry from '../../src/host/conversation/conversationTransferEntry'

function source(items: readonly ItemSnapshot[]): SessionExportSource {
  return {
    backend: 'modelApi',
    modelId: 'muse-spark-1.3',
    exportedAt: '2026-09-28T12:00:00.000Z',
    items,
  }
}

describe('conversationTransferEntry', () => {
  it('exposes the four flows the controller loads on first use', () => {
    expect(typeof entry.exportConversationFlow).toBe('function')
    expect(typeof entry.readTransferDocumentFlow).toBe('function')
    expect(typeof entry.transferRefusalFlow).toBe('function')
    expect(typeof entry.transferMessageCountFlow).toBe('function')
  })

  it('parses, refuses nothing, and counts a document the real exporter built', async () => {
    const items: readonly ItemSnapshot[] = [
      { itemId: 'u1', kind: 'userMessage', status: 'completed', text: 'first question' },
      { itemId: 'a1', kind: 'agentMessage', status: 'completed', text: 'first answer' },
      { itemId: 'u2', kind: 'userMessage', status: 'completed', text: 'second question' },
    ]
    const { doc } = await buildSessionExport(source(items), { redact: true, localRoots: [] })
    const parsed = entry.readTransferDocumentFlow(JSON.stringify(doc), EN, 'en')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.doc.transcript.length).toBe(items.length)
    expect(entry.transferRefusalFlow(parsed.doc, EN, 'en')).toBeUndefined()
    expect(entry.transferMessageCountFlow(parsed.doc.transcript, EN, 'en')).toBe(
      messageCount(parsed.doc.transcript),
    )
    expect(entry.transferMessageCountFlow(parsed.doc.transcript, EN, 'en')).toBe(3)
  })

  it('reads a syntax error as the fixed refusal', () => {
    expect(entry.readTransferDocumentFlow('{not json', EN, 'en')).toEqual({
      ok: false,
      reason: UI_TEXT.transferNotAnExport,
    })
  })
})
