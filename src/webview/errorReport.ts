// What the webview tells the host's log when something throws (M39): where
// it came from, the error's own text and its stack, cut to the protocol's
// limits. Nothing else is added: no draft, no transcript.

import {
  WEBVIEW_DIST_SEGMENTS,
  WEBVIEW_ERROR_MESSAGE_MAX_CHARS,
  WEBVIEW_ERROR_STACK_MAX_CHARS,
  WEBVIEW_SCRIPT_FILE,
  type ReportWebviewErrorKind,
  type WebviewErrorSource,
} from '../shared/constants'
import type { WebviewToHostMessage } from '../shared/protocol'
import { packageFramesOf, reportCodeOf, stackOf } from '../shared/stackFrames'

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

/** The webview bundle as the package ships it: the only file its frames may name. */
const WEBVIEW_FRAME_PATH = [...WEBVIEW_DIST_SEGMENTS, WEBVIEW_SCRIPT_FILE].join('/')

/**
 * The scrubbed failure for the report workflow (M93, PLAN.md D72): the event
 * kind, where it came from, the error's class when it is a known one (the
 * fixed unknown word otherwise) and the frames inside this webview's own
 * bundle — never the error's message, stack text, a function name, an
 * absolute URL or anything the user typed. A frame counts only when its
 * location is exactly `ownScriptUrl` (the bundle's resolved URL, read once at
 * load); it is then named by the package path, so the URL (which holds the
 * install folder) never leaves. Without a known script URL no frame is kept.
 * The recorder checks code and path vocabularies again on the host. A
 * `hostMessage` failure has no journal kind, so callers do not send one.
 */
export function reportWebviewErrorMessage(
  kind: ReportWebviewErrorKind,
  source: WebviewErrorSource,
  error: unknown,
  ownScriptUrl: string | undefined,
): Extract<WebviewToHostMessage, { type: 'reportWebviewError' }> {
  const frames =
    ownScriptUrl === undefined || ownScriptUrl === ''
      ? []
      : packageFramesOf(stackOf(error), (location) =>
          location === ownScriptUrl ? WEBVIEW_FRAME_PATH : undefined,
        )
  return {
    type: 'reportWebviewError',
    kind,
    source,
    code: reportCodeOf(error),
    frames: [...frames],
  }
}
