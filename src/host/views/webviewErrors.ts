// Webview errors in the host's log (M39). The webview reports what threw:
// a render the error boundary caught, an error or a rejected promise nothing
// handled, a host message it could not use. Each panel logs at most
// WEBVIEW_ERROR_LOG_LIMIT a minute, then says once that it stopped, so a
// render loop cannot flood the log.

import { WEBVIEW_ERROR_LOG_LIMIT, WEBVIEW_ERROR_WINDOW_MS } from '../../shared/constants'
import type { WebviewToHostMessage } from '../../shared/protocol'
import type { Logger } from '../logger'

export type WebviewErrorMessage = Extract<WebviewToHostMessage, { type: 'webviewError' }>

/** One panel's error log: call it with each report. */
export function webviewErrorLog(
  log: Logger,
  now: () => number,
): (report: WebviewErrorMessage) => void {
  let recent: readonly number[] = []
  let isMuted = false
  return (report) => {
    const at = now()
    recent = recent.filter((logged) => at - logged < WEBVIEW_ERROR_WINDOW_MS)
    if (recent.length >= WEBVIEW_ERROR_LOG_LIMIT) {
      if (!isMuted) {
        isMuted = true
        log.warn(
          `More webview errors in this minute are not logged (${String(WEBVIEW_ERROR_LOG_LIMIT)} were)`,
        )
      }
      return
    }
    isMuted = false
    recent = [...recent, at]
    const stack = report.stack === undefined ? '' : `\n${report.stack}`
    log.error(`Webview error (${report.source}): ${report.message}${stack}`)
  }
}
