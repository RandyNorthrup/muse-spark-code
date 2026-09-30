// Webview entry: mounts the React app and connects it to VS Code through the
// host bridge (hostBridge.ts, M61). The UI store lives here, outside the
// error boundary (M25): it starts from the conversation this panel saved in
// VS Code's webview state, keeps reducing host messages while the crash
// screen shows, and is saved again (throttled, and at once before a reload)
// so the crash screen's Reload comes back with the conversation. The display
// language's table goes in before anything reads the text (PLAN.md D33).

import { createRoot } from 'react-dom/client'
import { WEBVIEW_ROOT_ELEMENT_ID } from '../shared/constants'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { type ErrorReporter, webviewErrorReport } from './errorReport'
import { vsCodeHostBridge } from './hostBridge'
import { installEmbeddedTable } from './installTable'
import { restoredUiState } from './state/snapshot'
import { createUiStore, listenToHost, persistStore } from './state/store'
import './styles.css'

const host = vsCodeHostBridge(window)
const rootElement = document.querySelector(`#${WEBVIEW_ROOT_ELEMENT_ID}`)
if (rootElement === null) {
  throw new Error(`Webview root element #${WEBVIEW_ROOT_ELEMENT_ID} is missing`)
}

// What throws here reaches the host's log (M39): a render the boundary
// caught, an error or a rejected promise nothing handled, a host message.
const report: ErrorReporter = (source, error) => {
  host.post(webviewErrorReport(source, error))
}
window.addEventListener('error', (event) => {
  const error: unknown = event.error ?? event.message
  report('window', error)
})
window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason
  report('promise', reason)
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

createRoot(rootElement).render(
  <ErrorBoundary
    onError={(error) => {
      report('render', error)
    }}
    onReload={() => {
      // A state that crashed the very first render would crash the reloaded
      // one too: it is saved without its transcript then.
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
