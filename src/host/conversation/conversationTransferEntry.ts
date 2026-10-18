// The conversation's transfer flows (M30 export, M84 portable JSON
// import and share files, PLAN.md D49): esbuild builds this file into
// dist/conversationTransfer.js, which the conversation controller imports
// the first time the person exports, imports or opens a share file, so
// dist/conversation.js does not carry the export builders, the transcript
// renderer and the transfer schemas (PLAN.md D6). The loader installs the
// caller's language table with setUiText before the first call, as the
// production media bundle does, because the previews read UI_TEXT.
export {
  exportConversation,
  type ConversationExports,
  type ExportOutcome,
  type ExportPreview,
  type ExportPreviewChoice,
} from './exportConversation'
export {
  readTransferDocument,
  type PickedTransferFile,
  type SessionTransferFiles,
} from './sessionImport'
export { importRefusal, messageCount, type SessionExport } from '../../core/export/sessionTransfer'
export { setUiText } from '../../shared/l10n/text'
