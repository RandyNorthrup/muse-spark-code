// "Export conversation…" (M30, PLAN.md D30; portable JSON in M84, PLAN.md
// D49): the session's own history as Markdown on either backend, as portable
// JSON on either backend, or, on Muse Code, the CLI's JSON session log
// (`muse export`). The JSON export is built from the same history as the
// Markdown one; it is redacted by default and previewed before anything is
// written, and known credential shapes and the key digest never enter it (a
// secret in another shape is not recognised, hence the preview). The
// controller supplies its session and host; the dialogs and the file write
// are injected.

import { redactSecrets } from '../../core/redact'
import type { AgentHost, AgentSession } from '../../core/agent/agentBackend'
import {
  type BuiltSessionExport,
  buildSessionExport,
  messageCount,
  type SessionExportSource,
} from '../../core/export/sessionTransfer'
import { exportFileName, renderTranscriptMarkdown } from '../../core/export/transcriptMarkdown'
import {
  EXPORT_FILE_EXTENSIONS,
  EXPORT_TITLE_MAX_CHARS,
  type ExportFormat,
  SESSION_EXPORT_MAX_BYTES,
  SESSION_EXPORT_MAX_ITEMS,
  UI_TEXT,
} from '../../shared/constants'
import type { ItemSnapshot } from '../../shared/agentEvents'
import { plural } from '../../shared/l10n/text'
import { backendLabel } from '../../shared/paletteFormatting'

/** The portable file before it is written (M84): what the preview opens and says. */
export interface ExportPreview {
  readonly fileName: string
  /** The redacted file, exactly as it would be written. */
  readonly content: string
  /** What was redacted, one line each. */
  readonly detail: string
}

export interface ConversationExports {
  /** Asks where to save the Markdown and writes it; resolves unwritten when dismissed. */
  readonly saveMarkdown: (fileName: string, content: string) => Promise<void>
  /** Asks where to save, then has the CLI write the session's JSON log there. */
  readonly saveSessionLog: (sessionId: string, fileName: string) => Promise<void>
  /** Asks where to save the portable JSON and writes it; resolves unwritten when dismissed. */
  readonly saveJson: (fileName: string, content: string) => Promise<void>
  /**
   * The preview (M84): opens the redacted file read-only, never on disk, and
   * asks whether to save it redacted, save it without redaction, or not at all.
   */
  readonly previewExport: (preview: ExportPreview) => Promise<ExportPreviewChoice>
  /** This machine's own folders, redacted wherever they appear: the workspace folders and the home folder. */
  readonly localRoots: () => readonly string[]
}

export type ExportPreviewChoice = 'redacted' | 'full' | 'dismissed'

/**
 * `historyUnavailable`: Muse Code answered with history mode `none` (a
 * conversation past its replay budget), so an export would hold nothing but
 * its header; the session log still has everything. `empty`: nothing has
 * been said yet. `tooLarge`: the portable file would be past what an import
 * reads, so it is not written. `dismissed`: the preview was closed.
 */
export type ExportOutcome =
  'exported' | 'logUnavailable' | 'historyUnavailable' | 'empty' | 'tooLarge' | 'dismissed'

const USER_MESSAGE = 'userMessage'
// MSP `session/read` history mode when it returns no items (a budget, D26).
const HISTORY_MODE_NONE = 'none'
const LINE_BREAK = /\r?\n/
const JSON_INDENT = 2

/** The session's name, else its first prompt's first line, else a generic title. */
function titleOf(name: string | undefined, items: readonly ItemSnapshot[]): string {
  if (name !== undefined && name.trim() !== '') {
    return name.trim()
  }
  const prompt = items.find((item) => item.kind === USER_MESSAGE)?.text?.trim() ?? ''
  const firstLine = prompt.split(LINE_BREAK, 1)[0] ?? ''
  return firstLine === '' ? UI_TEXT.exportDefaultTitle : firstLine.slice(0, EXPORT_TITLE_MAX_CHARS)
}

/** The portable file's text; undefined when it is past what an import reads. */
async function portableFile(
  source: SessionExportSource,
  shouldRedact: boolean,
  localRoots: readonly string[],
): Promise<{ readonly content: string; readonly built: BuiltSessionExport } | undefined> {
  const built = await buildSessionExport(source, { redact: shouldRedact, localRoots })
  const content = JSON.stringify(built.doc, undefined, JSON_INDENT)
  return Buffer.byteLength(content) > SESSION_EXPORT_MAX_BYTES ? undefined : { content, built }
}

/** Portable JSON (M84): the redacted file previewed first, the chosen one written. */
async function exportJson(
  host: Pick<AgentHost, 'info' | 'readSession'>,
  session: Pick<AgentSession, 'sessionId' | 'modelId'>,
  now: Date,
  exports: ConversationExports,
): Promise<ExportOutcome> {
  const history = await host.readSession(session.sessionId)
  if (history.mode === HISTORY_MODE_NONE) {
    return 'historyUnavailable'
  }
  if (history.items.length === 0) {
    return 'empty'
  }
  if (history.items.length > SESSION_EXPORT_MAX_ITEMS) {
    return 'tooLarge'
  }
  const source: SessionExportSource = {
    backend: host.info.kind,
    ...(history.name !== undefined && { name: history.name }),
    modelId: session.modelId,
    exportedAt: now.toISOString(),
    items: history.items,
  }
  const localRoots = exports.localRoots()
  const redacted = await portableFile(source, true, localRoots)
  if (redacted === undefined) {
    return 'tooLarge'
  }
  const { built } = redacted
  // Named from the redacted title: a file name travels with the file.
  const fileName = exportFileName(
    titleOf(built.doc.name, built.doc.transcript),
    now,
    EXPORT_FILE_EXTENSIONS.json,
  )
  const choice = await exports.previewExport({
    fileName,
    content: redacted.content,
    detail: [
      UI_TEXT.exportPreviewOpen,
      plural(UI_TEXT.exportPreviewMessages, messageCount(history.items)),
      plural(UI_TEXT.exportPreviewPaths, built.paths),
      plural(UI_TEXT.exportPreviewAccounts, built.accounts),
      plural(UI_TEXT.exportPreviewSecrets, built.secrets),
      UI_TEXT.exportPreviewKnownCredentials,
    ].join('\n'),
  })
  if (choice === 'dismissed') {
    return 'dismissed'
  }
  const chosen = choice === 'full' ? await portableFile(source, false, localRoots) : redacted
  if (chosen === undefined) {
    return 'tooLarge'
  }
  await exports.saveJson(fileName, chosen.content)
  return 'exported'
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
  if (format === 'json') {
    return await exportJson(host, session, now, exports)
  }
  const history = await host.readSession(session.sessionId)
  const title = redactSecrets(titleOf(history.name, history.items))
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
    redactSecrets(
      renderTranscriptMarkdown({
        title,
        sessionId: session.sessionId,
        backendLabel: backendLabel(host.info.kind),
        modelId: session.modelId,
        exportedAt: now.toISOString(),
        items: history.items,
      }),
    ),
  )
  return 'exported'
}
