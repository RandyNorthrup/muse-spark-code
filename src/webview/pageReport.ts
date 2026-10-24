// A page entry's failure record (M39), shared by the Models & Agents panel
// and the judge setup wizard: what throws on the way reaches the host's log
// through the page's own bridge — an error or a rejected promise nothing
// handled, a display table the page refused — and the page keeps the
// reporter for its renders and host messages.

import type { ErrorReporter } from './errorReport'
import { webviewErrorReport } from './errorReport'
import type { HostBridge } from './hostBridge'
import { installEmbeddedTable } from './installTable'

/** Starts the page's failure record and installs its display table; the reporter for the rest. */
export function reportPageFailures(bridge: HostBridge): ErrorReporter {
  const report: ErrorReporter = (source, error) => {
    bridge.post(webviewErrorReport(source, error))
  }
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason
    report('promise', reason)
  })
  window.addEventListener('error', (event) => {
    const error: unknown = event.error ?? event.message
    report('window', error)
  })
  // The table came from the host, so a refused one is logged as a host message's.
  const tableError = installEmbeddedTable(document)
  if (tableError !== undefined) {
    report('hostMessage', tableError)
  }
  return report
}
