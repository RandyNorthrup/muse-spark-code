// What the webview tells the host's log when something throws (M39): where
// it came from, the error's own text and its stack, cut to the protocol's
// limits. Nothing else is added: no draft, no transcript.

import {
  WEBVIEW_ERROR_MESSAGE_MAX_CHARS,
  WEBVIEW_ERROR_STACK_MAX_CHARS,
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
