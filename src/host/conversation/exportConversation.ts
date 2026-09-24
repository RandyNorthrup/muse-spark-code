// "Export conversation…" (M30, PLAN.md D30): the session's own history as
// Markdown on either backend, or, on Muse Code, the CLI's JSON session log
// (`muse export`). The controller supplies its session and host; the save
// dialog and the file write are injected.

import type { AgentHost, AgentSession } from '../../core/agent/agentBackend'
import { exportFileName, renderTranscriptMarkdown } from '../../core/export/transcriptMarkdown'
import {
  EXPORT_FILE_EXTENSIONS,
  EXPORT_TITLE_MAX_CHARS,
  type ExportFormat,
  UI_TEXT,
} from '../../shared/constants'
import type { ItemSnapshot } from '../../shared/agentEvents'
import { BACKEND_LABELS } from '../../shared/palette'

export interface ConversationExports {
  /** Asks where to save the Markdown and writes it; resolves unwritten when dismissed. */
  readonly saveMarkdown: (fileName: string, content: string) => Promise<void>
  /** Asks where to save, then has the CLI write the session's JSON log there. */
  readonly saveSessionLog: (sessionId: string, fileName: string) => Promise<void>
}

/**
 * `historyUnavailable`: Muse Code answered with history mode `none` (a
 * conversation past its replay budget), so a Markdown export would hold
 * nothing but its header; the session log still has everything. `empty`:
 * nothing has been said yet.
 */
export type ExportOutcome = 'exported' | 'logUnavailable' | 'historyUnavailable' | 'empty'

const USER_MESSAGE = 'userMessage'
// MSP `session/read` history mode when it returns no items (a budget, D26).
const HISTORY_MODE_NONE = 'none'
const LINE_BREAK = /\r?\n/

/** The session's name, else its first prompt's first line, else a generic title. */
function titleOf(name: string | undefined, items: readonly ItemSnapshot[]): string {
  if (name !== undefined && name.trim() !== '') {
    return name.trim()
  }
  const prompt = items.find((item) => item.kind === USER_MESSAGE)?.text?.trim() ?? ''
  const firstLine = prompt.split(LINE_BREAK, 1)[0] ?? ''
  return firstLine === '' ? UI_TEXT.exportDefaultTitle : firstLine.slice(0, EXPORT_TITLE_MAX_CHARS)
}

/** Throws when the history cannot be read or the file cannot be written. */
export async function exportConversation(
  host: Pick<AgentHost, 'info' | 'readSession'>,
  session: Pick<AgentSession, 'sessionId' | 'modelId'>,
  format: ExportFormat,
  now: Date,
  exports: ConversationExports,
): Promise<ExportOutcome> {
  if (format === 'sessionLog' && host.info.kind !== 'museCode') {
    return 'logUnavailable'
  }
  const history = await host.readSession(session.sessionId)
  const title = titleOf(history.name, history.items)
  const fileName = exportFileName(title, now, EXPORT_FILE_EXTENSIONS[format])
  if (format === 'sessionLog') {
    await exports.saveSessionLog(session.sessionId, fileName)
    return 'exported'
  }
  // Never a header-only file that reads as a successful export.
  if (history.mode === HISTORY_MODE_NONE) {
    return 'historyUnavailable'
  }
  if (history.items.length === 0) {
    return 'empty'
  }
  await exports.saveMarkdown(
    fileName,
    renderTranscriptMarkdown({
      title,
      sessionId: session.sessionId,
      backendLabel: BACKEND_LABELS[host.info.kind],
      modelId: session.modelId,
      exportedAt: now.toISOString(),
      items: history.items,
    }),
  )
  return 'exported'
}
