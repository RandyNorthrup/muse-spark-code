// Webview entry: mounts the React app and connects it to VS Code through the
// host bridge (hostBridge.ts, M61). The UI store lives here, outside the
// error boundary (M25): it starts from the conversation this panel saved in
// VS Code's webview state, keeps reducing host messages while the crash
// screen shows, and is saved again (throttled, and at once before a reload)
// so the crash screen's Reload comes back with the conversation. The display
// language's table goes in before anything reads the text (PLAN.md D33).

import { createRoot } from 'react-dom/client'
import { WEBVIEW_ROOT_ELEMENT_ID } from '../shared/constants'
import { hostToWebviewMessageSchema, webviewToHostMessageSchema } from '../shared/protocol'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { type ErrorReporter, webviewErrorReport } from './errorReport'
import type { PanelBridge } from './bridges/types'
import { vscodeBridge } from './bridges/vscode'
import { showBridgeFailure } from './bridges/failure'
import { installEmbeddedTable } from './installTable'
import { restoredUiState } from './state/snapshot'
import { createUiStore, listenToHost, persistStore } from './state/store'
import './tokens.css'
import './styles.css'

const rootElement = document.querySelector(`#${WEBVIEW_ROOT_ELEMENT_ID}`)
if (rootElement === null) {
  throw new Error(`Webview root element #${WEBVIEW_ROOT_ELEMENT_ID} is missing`)
}

async function mount(rootElement: Element): Promise<void> {
  const isTasks = document.body.dataset['surface'] === 'tasks'
  const { selectBridge } = await import('./bridges/select')
  const tasks = isTasks ? await import('../shared/tasksProtocol') : undefined
  const host = await selectBridge(
    {
      outgoing: tasks?.tasksWebviewMessageSchema ?? webviewToHostMessageSchema,
      incoming: tasks?.tasksHostMessageSchema ?? hostToWebviewMessageSchema,
    },
    (error) => {
      reportBridgeFailure(error)
    },
  )
  connect(rootElement, host, isTasks)
}

function connect(rootElement: Element, host: PanelBridge, isTasks: boolean): void {
  window.addEventListener(
    'pagehide',
    () => {
      host.dispose()
    },
    { once: true },
  )
  if (isTasks) {
    void mountTasks(rootElement, host).catch(reportBridgeFailure)
  } else {
    mountChat(rootElement, host)
  }
}

async function mountTasks(rootElement: Element, host: PanelBridge): Promise<void> {
  const tableError = installEmbeddedTable(document)
  if (tableError !== undefined) throw tableError
  const { TasksApp } = await import('./TasksApp')
  createRoot(rootElement).render(
    <TasksApp
      messages={host.messages}
      postMessage={(message) => {
        host.post(message)
      }}
    />,
  )
}
if (
  window.museHost !== undefined ||
  document.body.dataset['bridge'] === 'companion' ||
  document.body.dataset['surface'] === 'tasks'
) {
  void mount(rootElement).catch((error: unknown) => {
    reportBridgeFailure(error)
  })
} else {
  // VS Code's chat mounts in the same task, preserving its startup and host timing.
  const host = vscodeBridge(
    window,
    {
      outgoing: webviewToHostMessageSchema,
      incoming: hostToWebviewMessageSchema,
    },
    (error) => {
      host.post(webviewErrorReport('hostMessage', error))
    },
  )
  connect(rootElement, host, false)
}

function mountChat(element: Element, host: PanelBridge): void {
  // What throws here reaches the host's log (M39): a render the boundary
  // caught, an error or a rejected promise nothing handled, a host message.
  const report: ErrorReporter = (source, error) => {
    try {
      host.post(webviewErrorReport(source, error))
    } catch {
      showBridgeFailure(document)
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

  createRoot(element).render(
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
}

function reportBridgeFailure(_error: unknown): void {
  showBridgeFailure(document)
}
