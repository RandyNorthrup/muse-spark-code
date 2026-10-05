// The Models & Agents panel's entry (→ `dist/webview/models.js`, the
// second webview entry beside `main.js`). Mounts the panel and connects it
// to the host through the same bridge as the chat panel. The panel state
// is host-owned: this side keeps the navigation UI, renders the host's
// slices, and asks. Errors reach the host's log through the shared error
// report (lane K's bridge accepts `webviewError` and `openExternal`
// beside the panel's own messages); the display language's table goes in
// before the first render (PLAN.md D33).

import { createRoot } from 'react-dom/client'
import { Component, type ReactNode, useEffect, useReducer, useState } from 'react'
import { UI_TEXT, WEBVIEW_ROOT_ELEMENT_ID } from '../../shared/constants'
import {
  parseHostToPanelMessage,
  type ModelsPanelState,
  type PanelToHostMessage,
} from '../../shared/modelsPanel'
import type { ErrorReporter } from '../errorReport'
import { webviewErrorReport } from '../errorReport'
import { type HostBridge, vsCodeHostBridge } from '../hostBridge'
import { installEmbeddedTable } from '../installTable'
import { ModelsPanel } from './panel'
import { INITIAL_PANEL_UI, panelUiReducer } from './reducer'
import './models.css'

interface CrashState {
  readonly crashed: boolean
}

class PanelBoundary extends Component<
  { readonly children: ReactNode; readonly onError: (error: unknown) => void },
  CrashState
> {
  constructor(props: { readonly children: ReactNode; readonly onError: (error: unknown) => void }) {
    super(props)
    this.state = { crashed: false }
  }

  static getDerivedStateFromError(): CrashState {
    return { crashed: true }
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

function ModelsApp({ host, report }: { readonly host: HostBridge; readonly report: ErrorReporter }) {
  const [ui, dispatch] = useReducer(panelUiReducer, INITIAL_PANEL_UI)
  const [panelState, setPanelState] = useState<ModelsPanelState | undefined>(undefined)
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const parsed = parseHostToPanelMessage(event.data)
      if (!parsed.ok) {
        report('hostMessage', new Error(parsed.error))
        return
      }
      const message = parsed.message
      if (message.type === 'modelsPanel/state') {
        setPanelState(message.state)
        dispatch({ type: 'host-state', state: message.state })
      } else {
        dispatch({ type: 'host-navigate', section: message.section, itemId: message.itemId })
      }
    }
    host.messages.addEventListener('message', onMessage)
    return () => {
      host.messages.removeEventListener('message', onMessage)
    }
  }, [host, report])
  useEffect(() => {
    host.post({ type: 'modelsPanel/ready' })
  }, [host])
  const post = (message: PanelToHostMessage): void => {
    host.post(message)
  }
  return (
    <PanelBoundary
      onError={(error) => {
        report('render', error)
      }}
    >
      <ModelsPanel panelState={panelState} ui={ui} post={post} dispatch={dispatch} />
    </PanelBoundary>
  )
}

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

createRoot(rootElement).render(<ModelsApp host={host} report={report} />)
