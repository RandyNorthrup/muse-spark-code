// What the webview tells the host's log when something throws (M39): where
// it came from, the error's own text and its stack, cut to the protocol's
// limits. Nothing else is added: no draft, no transcript.

import {
  REPORT_FRAME_PATH_MAX_CHARS,
  REPORT_STACK_MAX_FRAMES,
  REPORT_UNKNOWN_ERROR_CODE,
  WEBVIEW_ERROR_MESSAGE_MAX_CHARS,
  WEBVIEW_ERROR_STACK_MAX_CHARS,
  type ReportWebviewErrorKind,
  type WebviewErrorSource,
} from '../shared/constants'
import type { WebviewToHostMessage } from '../shared/protocol'

export type ErrorReporter = (source: WebviewErrorSource, error: unknown) => void

export function webviewErrorReport(
  source: WebviewErrorSource,
  error: unknown,
): WebviewToHostMessage {
  const message = (error instanceof Error ? error.message : String(error)).slice(
    0,
    WEBVIEW_ERROR_MESSAGE_MAX_CHARS,
  )
  const stack =
    error instanceof Error ? error.stack?.slice(0, WEBVIEW_ERROR_STACK_MAX_CHARS) : undefined
  return { type: 'webviewError', source, message, ...(stack !== undefined && { stack }) }
}

const STACK_FRAME = /\(?([^()\s]+?):(\d+):(\d+)\)?$/

/**
 * The scrubbed failure for the report workflow (M93 lane W, PLAN.md D72):
 * the event kind, where it came from, a fixed code and bounded structural
 * frames — never the error's message, stack text, or anything the user
 * typed. The webview claims no code it cannot vouch for (always the fixed
 * unknown word) and no path shape: package-relative verification, code
 * vocabulary and traversal/URL rejection are the recorder's semantic
 * validation (lane R), not transport bounds. A `hostMessage` failure has no
 * journal kind, so callers do not send one for it.
 */
export function reportWebviewErrorMessage(
  kind: ReportWebviewErrorKind,
  source: WebviewErrorSource,
  error: unknown,
): Extract<WebviewToHostMessage, { type: 'reportWebviewError' }> {
  const lines =
    error instanceof Error && typeof error.stack === 'string' ? error.stack.split('\n') : []
  const frames: { readonly path: string; readonly line: number; readonly column: number }[] = []
  for (const line of lines) {
    if (frames.length >= REPORT_STACK_MAX_FRAMES) {
      break
    }
    const match = STACK_FRAME.exec(line.trim())
    if (match === null) {
      continue
    }
    const path = (match[1] ?? '').slice(0, REPORT_FRAME_PATH_MAX_CHARS)
    const lineNumber = Number(match[2])
    const column = Number(match[3])
    if (
      path === '' ||
      !Number.isSafeInteger(lineNumber) ||
      !Number.isSafeInteger(column) ||
      lineNumber < 1 ||
      column < 0
    ) {
      continue
    }
    frames.push({ path, line: lineNumber, column })
  }
  return {
    type: 'reportWebviewError',
    kind,
    source,
    code: REPORT_UNKNOWN_ERROR_CODE,
    frames,
  }
}
