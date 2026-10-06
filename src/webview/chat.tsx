// The shared chat mount keeps its store outside the error boundary and saves
// it before reload. Entries supply their own host; VS Code never imports the
// portable transports or host-service fallbacks.
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { type ErrorReporter, webviewErrorReport } from './errorReport'
import type { HostBridge } from './hostBridge'
import { installEmbeddedTable } from './installTable'
import { restoredUiState } from './state/snapshot'
import { createUiStore, listenToHost, persistStore } from './state/store'

export function mountChat(
  element: Element,
  host: HostBridge,
  onFailure?: (error: unknown) => void,
): void {
  const report: ErrorReporter = (source, error) => {
    try {
      host.post(webviewErrorReport(source, error))
    } catch (error_) {
      if (onFailure === undefined) throw error_
      onFailure(error_)
    }
  }
  window.addEventListener('error', (event) => {
    const error: unknown = event.error ?? event.message
    report('window', error)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason
    report('promise', reason)
  })
  const tableError = installEmbeddedTable(document)
  if (tableError !== undefined) report('hostMessage', tableError)

  const store = createUiStore(restoredUiState(host.savedState()))
  listenToHost(store, host.messages, () => Date.now(), report)
  const persister = persistStore(store, (state) => {
    host.saveState(state)
  })
  window.addEventListener('pagehide', () => {
    persister.flush(store.hasRendered())
  })
  createRoot(element).render(
    <ErrorBoundary
      onError={(error) => {
        report('render', error)
      }}
      onReload={() => {
        // A first-render crash reloads without the transcript that caused it.
        persister.flush(store.hasRendered())
        host.post({ type: 'hostAction', action: 'reload' })
      }}
    >
      <App
        store={store}
        postMessage={(message) => {
          host.post(message)
        }}
      />
    </ErrorBoundary>,
  )
}
