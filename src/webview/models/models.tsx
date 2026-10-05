// The Models & Agents panel's entry (→ `dist/webview/models.js`, the
// second webview entry beside `main.js`). Mounts the panel and connects it
// to the host through the same bridge as the chat panel. The panel state
// is host-owned: this side keeps the navigation UI, renders the host's
// slices, and asks. Errors reach the host's log through the shared error
// report (lane K's bridge accepts `webviewError` and `openExternal`
// beside the panel's own messages); the display language's table goes in
// before the first render (PLAN.md D33).

import { createRoot } from 'react-dom/client'
import { Component, type ReactNode } from 'react'
import { UI_TEXT, WEBVIEW_ROOT_ELEMENT_ID } from '../../shared/constants'
import type { ErrorReporter } from '../errorReport'
import { webviewErrorReport } from '../errorReport'
import { type HostBridge, vsCodeHostBridge } from '../hostBridge'
import { installEmbeddedTable } from '../installTable'
import { ModelsApp } from './panel'
import './models.css'

interface CrashState {
  readonly crashed: boolean
}

class PanelBoundary extends Component<
  { readonly children: ReactNode; readonly onError: (error: unknown) => void },
  CrashState
> {
  static getDerivedStateFromError(): CrashState {
    return { crashed: true }
  }

  constructor(props: { readonly children: ReactNode; readonly onError: (error: unknown) => void }) {
    super(props)
    this.state = { crashed: false }
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError(error)
  }

  override render(): ReactNode {
    if (this.state.crashed) {
      // An explicit error, never an empty panel. Reloading re-renders
      // from the host's state; nothing typed lives only here.
      return (
        <div className="models-panel">
          <h2>{UI_TEXT.modelsPanelTitle}</h2>
          <p role="alert">{UI_TEXT.modelsPanelUnavailable}</p>
          <button
            type="button"
            className="models-button"
            onClick={() => {
              window.location.reload()
            }}
          >
            {UI_TEXT.crashReload}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// The panel boots once and keeps no module state besides the bridge it
// renders with. What throws on the way reaches the host's log (M39): a
// render the boundary caught, an error or a rejected promise nothing
// handled, a host message — all through the same bridge as the chat panel.
function startModelsPanel(root: Element, bridge: HostBridge): void {
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
  createRoot(root).render(
    <PanelBoundary
      onError={(error) => {
        report('render', error)
      }}
    >
      <ModelsApp host={bridge} report={report} />
    </PanelBoundary>,
  )
}

const rootElement = document.querySelector(`#${WEBVIEW_ROOT_ELEMENT_ID}`)
if (rootElement === null) {
  throw new Error(`Webview root element #${WEBVIEW_ROOT_ELEMENT_ID} is missing`)
}
startModelsPanel(rootElement, vsCodeHostBridge(window))
