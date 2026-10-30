// The chat surface's mount (M104 lane D, extracted from main.tsx): the UI
// store lives here, outside the error boundary (M25), starting from the
// state the bridge saved, reducing host messages while the crash screen
// shows, and saved again (throttled, and at once before a reload) so the
// crash screen's Reload comes back with the conversation. Every entry
// (VS Code's main.tsx, the portable native/companion entry) mounts the
// same chat over its own bridge.
import { createRoot } from 'react-dom/client'
import { useLayoutEffect, useSyncExternalStore } from 'react'
import type { WebviewToHostMessage } from '../shared/protocol'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DeferredReportDialog } from './components/DeferredReportDialog'
import { type ErrorReporter, reportWebviewErrorMessage, webviewErrorReport } from './errorReport'
import type { HostBridge } from './hostBridge'
import { installEmbeddedTable } from './installTable'
import { windowResourceLoader } from './resources/windowPort'
import { installSurfaceRetry, retrySurface } from './surfaceRetry'
import { restoredUiState } from './state/snapshot'
import { createUiStore, listenToHost, persistStore, type UiStore } from './state/store'

const ownScriptUrl = import.meta.url

/**
The report dialog over the crash screen (M93): the store outlives the
crashed tree and keeps reducing the host's `reportDraft` answers, so the
boundary's crash screen renders the dialog itself while the app's copy is
gone with the tree, and a render failure keeps its "Report a Problem" way on.
*/
function CrashReportDialog({
  store,
  postMessage,
}: {
  readonly store: UiStore
  readonly postMessage: (message: WebviewToHostMessage) => void
}) {
  const report = useSyncExternalStore(store.subscribe, () => store.getState().report)
  const isReportLoading = useSyncExternalStore(
    store.subscribe,
    () => store.getState().reportLoading,
  )
  if (report === undefined && !isReportLoading) {
    return null
  }
  return (
    <DeferredReportDialog
      key={report?.session ?? 'report-loading'}
      report={report}
      postMessage={postMessage}
      onClose={() => {
        store.dispatch({ type: 'reportClosed' })
      }}
    />
  )
}

function ChatMounted({ onMounted }: { readonly onMounted: () => void }) {
  useLayoutEffect(() => {
    onMounted()
  }, [onMounted])
  return null
}

export function mountChat(
  element: Element,
  host: HostBridge,
  onFailure?: (error: unknown) => void,
  onMounted?: () => void,
): void {
  // Exact prices load outside startup (STARTUP017): the mounted surfaces
  // fetch the money chunk through its hooks, each retrying on its own.
  // What throws here reaches the host's log (M39): a render the boundary
  // caught, an error or a rejected promise nothing handled, a host message.
  // Window errors, rejected promises and boundary failures also post the
  // scrubbed shape for the report workflow (M93): bounded identifiers only,
  // never the error's text.
  const report: ErrorReporter = (source, error) => {
    try {
      host.post(webviewErrorReport(source, error))
    } catch (error_: unknown) {
      if (onFailure === undefined) throw error_
      onFailure(error_)
    }
  }
  window.addEventListener('error', (event) => {
    const error: unknown = event.error ?? event.message
    report('window', error)
    host.post(reportWebviewErrorMessage('windowError', 'window', error, ownScriptUrl))
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason
    report('promise', reason)
    host.post(reportWebviewErrorMessage('unhandledRejection', 'promise', reason, ownScriptUrl))
  })

  // The table came from the host, so a refused one is logged as a host message's.
  const tableError = installEmbeddedTable(document)
  if (tableError !== undefined) {
    report('hostMessage', tableError)
  }

  const store = createUiStore(restoredUiState(host.savedState()))
  listenToHost(store, host.messages, () => Date.now(), report)
  const persister = persistStore(store, (state) => {
    host.saveState(state)
  })
  installSurfaceRetry(
    () => {
      persister.flush(store.hasRendered())
    },
    () => {
      host.post({ type: 'hostAction', action: 'reload' })
    },
  )
  // The document goes away (a reload, the panel closing): save what is shown.
  window.addEventListener('pagehide', () => {
    persister.flush(store.hasRendered())
  })
  const postMessage = (message: WebviewToHostMessage) => {
    host.post(message)
  }
  // M107 U–C1: the window governor's chip, mounted once the host sends a status.
  const resources = windowResourceLoader(store, postMessage)

  createRoot(element).render(
    <>
      <ErrorBoundary
        onError={(error) => {
          report('render', error)
          host.post(reportWebviewErrorMessage('reactBoundary', 'render', error, ownScriptUrl))
        }}
        crashOverlay={<CrashReportDialog store={store} postMessage={postMessage} />}
        onReportProblem={() => {
          // No row text exists here: the handoff carries no reference, and
          // the host builds the report from its journal alone. The dialog
          // opens working while the host gathers (lane REPORTFLOW R2).
          store.dispatch({ type: 'reportOpening' })
          host.post({ type: 'openReport' })
        }}
        onReload={retrySurface}
      >
        <App store={store} postMessage={postMessage} resources={resources} />
        {onMounted !== undefined && <ChatMounted onMounted={onMounted} />}
      </ErrorBoundary>
    </>,
  )
}
