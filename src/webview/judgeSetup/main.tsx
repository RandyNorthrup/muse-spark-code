// D107 (M125 lane W): the Set Up Local Judge wizard's entry
// (→ `dist/webview/judgeSetup.js`). Mounts the wizard and connects it
// to the host through the shared bridge. The wizard state is
// host-owned: this side renders the host's snapshots and posts its
// commands. Errors reach the host's log through the shared error
// report; the display language's table goes in before the first
// render (PLAN.md D33).
import { createRoot } from 'react-dom/client'
import { Component, lazy, Suspense, type ReactNode } from 'react'
import { UI_TEXT, WEBVIEW_ROOT_ELEMENT_ID } from '../../shared/constants'
import type { ErrorReporter } from '../errorReport'
import { webviewErrorReport } from '../errorReport'
import { type HostBridge, vsCodeHostBridge } from '../hostBridge'
import { installEmbeddedTable } from '../installTable'
import { DeferredSurface } from '../components/DeferredSurface'
import './judgeSetup.css'

const JudgeSetupApp = lazy(async () => {
  const module = await import('./JudgeSetupApp')
  return { default: module.JudgeSetupApp }
})

interface CrashState {
  readonly crashed: boolean
}

class WizardBoundary extends Component<
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
      return (
        <div className="js-panel">
          <h2>{UI_TEXT.judgeSetupWizard.title}</h2>
          <p role="alert">{UI_TEXT.judgeSetupWizard.unavailable}</p>
          <button
            type="button"
            className="js-button"
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

function startSetupWizard(root: Element, bridge: HostBridge): void {
  const report: ErrorReporter = (source, error) => {
    bridge.post(webviewErrorReport(source, error))
  }
  window.addEventListener('unhandledrejection', (event) => {
    report('promise', event.reason)
  })
  window.addEventListener('error', (event) => {
    report('window', event.error ?? event.message)
  })
  const tableError = installEmbeddedTable(document)
  if (tableError !== undefined) {
    report('hostMessage', tableError)
  }
  createRoot(root).render(
    <WizardBoundary
      onError={(error) => {
        report('render', error)
      }}
    >
      <DeferredSurface
        isModal={false}
        fallback={
          <div className="js-panel">
            <h2>{UI_TEXT.judgeSetupWizard.title}</h2>
            <p role="status">{UI_TEXT.loadingOutput}</p>
          </div>
        }
      >
        <Suspense
          fallback={
            <div className="js-panel">
              <h2>{UI_TEXT.judgeSetupWizard.title}</h2>
              <p role="status">{UI_TEXT.loadingOutput}</p>
            </div>
          }
        >
          <JudgeSetupApp host={bridge} report={report} />
        </Suspense>
      </DeferredSurface>
    </WizardBoundary>,
  )
}

const root = document.querySelector(`#${WEBVIEW_ROOT_ELEMENT_ID}`)
if (root === null) {
  throw new Error('judge setup wizard has no root element')
}
startSetupWizard(root, vsCodeHostBridge(window))
