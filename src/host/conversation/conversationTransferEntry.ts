// The conversation's session-transfer flows as a bundle of their own (D6):
// esbuild builds this file into dist/conversationTransfer.js, which the
// conversation controller requires the first time an export, an import or a
// share-file preview runs, so the session-export builder, the transcript
// renderer, the transfer parse and the import refusal stay out of the first
// chat surface. Like rulesFileEntry, each function installs the caller's
// table before delegating: the bundle keeps its own installed-language
// state.
import type { AgentHost, AgentSession } from '../../core/agent/agentBackend'
import {
  type SessionExport,
  type SessionExportParse,
  importRefusal as refusalOf,
  messageCount as countOf,
} from '../../core/export/sessionTransfer'
import type { ItemSnapshot } from '../../shared/agentEvents'
import type { ExportFormat } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import {
  type ConversationExports,
  type ExportOutcome,
  exportConversation as exportFlow,
} from './exportConversation'
import { readTransferDocument as readDocument } from './sessionImport'

/** An export that wrote, previewed or refused, in the caller's language. */
export function exportConversationFlow(
  host: Pick<AgentHost, 'info' | 'readSession'>,
  session: Pick<AgentSession, 'sessionId' | 'modelId'>,
  format: ExportFormat,
  now: Date,
  exports: ConversationExports,
  table: UiText,
  locale: string,
): Promise<ExportOutcome> {
  setUiText(table, locale)
  return exportFlow(host, session, format, now, exports)
}

/** A picked file's text parsed without a throw, in the caller's language. */
export function readTransferDocumentFlow(
  content: string,
  table: UiText,
  locale: string,
): SessionExportParse {
  setUiText(table, locale)
  return readDocument(content)
}

/** Why a parsed export cannot be imported, if it cannot, in the caller's language. */
export function transferRefusalFlow(
  doc: SessionExport,
  table: UiText,
  locale: string,
): string | undefined {
  setUiText(table, locale)
  return refusalOf(doc)
}

/** How many messages an import preview names, in the caller's language. */
export function transferMessageCountFlow(
  transcript: readonly Pick<ItemSnapshot, 'kind'>[],
  table: UiText,
  locale: string,
): number {
  setUiText(table, locale)
  return countOf(transcript)
}
