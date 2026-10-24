// D107 (M125 lane W): the Set Up Local Judge wizard's entry
// (→ `dist/webview/judgeSetup.js`). Mounts the wizard and connects it
// to the host through the shared bridge. The wizard state is
// host-owned: this side renders the host's snapshots and posts its
// commands. Errors reach the host's log through the shared error
// report; the display language's table goes in before the first
// render (PLAN.md D33).
import { createRoot } from 'react-dom/client'
import { lazy, Suspense } from 'react'
import { UI_TEXT, WEBVIEW_ROOT_ELEMENT_ID } from '../../shared/constants'
import { type HostBridge, vsCodeHostBridge } from '../hostBridge'
import { reportPageFailures } from '../pageReport'
import { DeferredSurface } from '../components/DeferredSurface'
import { PageBoundary } from '../components/PageBoundary'
import '../models/controls.css'
import './judgeSetup.css'

const JudgeSetupApp = lazy(async () => {
  const module = await import('./JudgeSetupApp')
  return { default: module.JudgeSetupApp }
})

function startSetupWizard(root: Element, bridge: HostBridge): void {
  const report = reportPageFailures(bridge)
  createRoot(root).render(
    <PageBoundary
      crashed={{
        className: 'js-panel',
        title: UI_TEXT.judgeSetupWizard.title,
        message: UI_TEXT.judgeSetupWizard.unavailable,
      }}
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
    </PageBoundary>,
  )
}

const root = document.querySelector(`#${WEBVIEW_ROOT_ELEMENT_ID}`)
if (root === null) {
  throw new Error('judge setup wizard has no root element')
}
startSetupWizard(root, vsCodeHostBridge(window))
