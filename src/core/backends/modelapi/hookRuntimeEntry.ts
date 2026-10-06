// The Model API backend's hook and MCP-form runtime (M91, PLAN.md D6), in a
// bundle of its own (dist/hookRuntime.js) that a session loads the first time
// it needs one of these, so dist/modelApi.js stays within its budget:
//
// - lane E's spark-hooks.json reader and its extension-event dispatcher;
// - lane H's typed handlers (http, mcp_tool, prompt and agent);
// - lane M's checks on an MCP server's form request and on the answer to it;
// - portable session-import sanitization (FIXM106T), on the first import.
//
// It loads only when a spark-hooks.json exists, a typed handler runs or a
// server asks for a form, or a session is imported. dist/modelApi.js
// keeps the modules' types, field builders and constants; esbuild leaves out
// what only this entry reaches.

import {
  sanitizeImportedSession,
  type SanitizeImportOptions,
  type SessionExport,
} from '../../export/sessionTransfer'
import type { UiText } from '../../../shared/l10n/en'
import { setUiText } from '../../../shared/l10n/text'
import type { StoredSession } from './sessionStore'

export function sanitizeSessionImport(
  doc: SessionExport,
  options: SanitizeImportOptions,
  context: {
    readonly table: UiText
    readonly locale: string
    readonly modelText: Parameters<typeof sanitizeImportedSession>[2]
  },
): StoredSession {
  setUiText(context.table, context.locale)
  return sanitizeImportedSession(doc, options, context.modelText)
}

export { dispatchExtensionHooks, loadSparkHookDefinitions } from './extensionHooks'
export { runTypedHandler } from './hookHandlers'
export {
  checkElicitationOutcome,
  parseElicitationParams,
  validateElicitationSchema,
  validateElicitationValues,
} from './mcp/elicitation'
