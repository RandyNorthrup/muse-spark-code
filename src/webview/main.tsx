// Webview entry: mounts the React app and connects it to VS Code through the
// host bridge (hostBridge.ts, M61). The UI store lives here, outside the
// error boundary (M25): it starts from the conversation this panel saved in
// VS Code's webview state, keeps reducing host messages while the crash
// screen shows, and is saved again (throttled, and at once before a reload)
// so the crash screen's Reload comes back with the conversation. The display
// language's table goes in before anything reads the text (PLAN.md D33).

import { createRoot } from 'react-dom/client'
import { useSyncExternalStore } from 'react'
import { WEBVIEW_ROOT_ELEMENT_ID } from '../shared/constants'
import type { WebviewToHostMessage } from '../shared/protocol'
import { App } from './App'
import { TasksApp } from './TasksApp'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ReportDialogHost } from './components/ReportDialog'
import { type ErrorReporter, reportWebviewErrorMessage, webviewErrorReport } from './errorReport'
import { vsCodeHostBridge } from './hostBridge'
import { installEmbeddedTable } from './installTable'
import { restoredUiState } from './state/snapshot'
import { createUiStore, listenToHost, persistStore, type UiStore } from './state/store'
import './styles.css'

// This bundle's own resolved URL, read while it first runs (M93): the
// report's frames name only locations inside it, as the package path, never
// the URL (which holds the install folder).
const ownScriptUrl =
  document.currentScript instanceof HTMLScriptElement ? document.currentScript.src : undefined

const rootElement = document.querySelector(`#${WEBVIEW_ROOT_ELEMENT_ID}`)
if (rootElement === null) {
  throw new Error(`Webview root element #${WEBVIEW_ROOT_ELEMENT_ID} is missing`)
}

/**
 * Whether the app tree is showing the crash screen (M93): the report dialog
 * then renders beside the boundary (which unmounted the app's own), so a
 * render failure keeps its "Report a problem" way on. A reload starts a fresh
 * document, which resets this with it.
 */
const treeCrash: { isCrashed: boolean } = { isCrashed: false }
const crashListeners = new Set<() => void>()
function noteTreeCrashed(): void {
  treeCrash.isCrashed = true
  for (const listener of crashListeners) {
    listener()
  }
}

/**
 * The report dialog over the crash screen (M93): the store outlives the
 * crashed tree and keeps reducing the host's `reportDraft` answers, so the
 * dialog renders here while the app's copy is gone with the tree. While the
 * app renders, this stays empty (its copy owns the dialog instead).
 */
function CrashReportDialog({
  store,
  postMessage,
}: {
  readonly store: UiStore
  readonly postMessage: (message: WebviewToHostMessage) => void
}) {
  const isCrashed = useSyncExternalStore(
    (listener) => {
      crashListeners.add(listener)
      return () => {
        crashListeners.delete(listener)
      }
    },
    () => treeCrash.isCrashed,
  )
  const report = useSyncExternalStore(store.subscribe, () => store.getState().report)
  if (!isCrashed || report === undefined) {
    return null
  }
  return (
    <ReportDialogHost
      key={report.session}
      report={report}
      postMessage={postMessage}
      onClose={() => {
        store.dispatch({ type: 'reportClosed' })
      }}
    />
  )
}

if (document.body.dataset['surface'] === 'tasks') {
  const api = acquireVsCodeApi()
  const tableError = installEmbeddedTable(document)
  if (tableError !== undefined) {
    throw tableError
  }
  createRoot(rootElement).render(
    <TasksApp
      messages={window}
      postMessage={(message) => {
        api.postMessage(message)
      }}
    />,
  )
} else {
  mountChat(rootElement)
}

function mountChat(element: Element): void {
  const host = vsCodeHostBridge(window)
  // What throws here reaches the host's log (M39): a render the boundary
  // caught, an error or a rejected promise nothing handled, a host message.
  // Window errors, rejected promises and boundary failures also post the
  // scrubbed shape for the report workflow (M93): bounded identifiers only,
  // never the error's text.
  const report: ErrorReporter = (source, error) => {
    host.post(webviewErrorReport(source, error))
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
  // The document goes away (a reload, the panel closing): save what is shown.
  window.addEventListener('pagehide', () => {
    persister.flush(store.hasRendered())
  })
  const postMessage = (message: WebviewToHostMessage) => {
    host.post(message)
  }

  createRoot(element).render(
    <>
      <ErrorBoundary
        onError={(error) => {
          report('render', error)
          host.post(reportWebviewErrorMessage('reactBoundary', 'render', error, ownScriptUrl))
          noteTreeCrashed()
        }}
        onReportProblem={() => {
          // No row text exists here: the handoff carries no reference, and
          // the host builds the report from its journal alone.
          host.post({ type: 'openReport' })
        }}
        onReload={() => {
          // A state that crashed the very first render would crash the reloaded
          // one too: it is saved without its transcript then.
          persister.flush(store.hasRendered())
          host.post({ type: 'hostAction', action: 'reload' })
        }}
      >
        <App store={store} postMessage={postMessage} />
      </ErrorBoundary>
      <CrashReportDialog store={store} postMessage={postMessage} />
    </>,
  )
}
