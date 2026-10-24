// The Models & Agents panel's entry (→ `dist/webview/models.js`, the
// second webview entry beside `main.js`). Mounts the panel and connects it
// to the host through the same bridge as the chat panel. The panel state
// is host-owned: this side keeps the navigation UI, renders the host's
// slices, and asks. Errors reach the host's log through the shared error
// report (lane K's bridge accepts `webviewError` and `openExternal`
// beside the panel's own messages); the display language's table goes in
// before the first render (PLAN.md D33).

import { createRoot } from 'react-dom/client'
import { lazy } from 'react'
import { UI_TEXT, WEBVIEW_ROOT_ELEMENT_ID } from '../../shared/constants'
import { type HostBridge, vsCodeHostBridge } from '../hostBridge'
import { reportPageFailures } from '../pageReport'
import { DeferredSurface } from '../components/DeferredSurface'
import { PageBoundary } from '../components/PageBoundary'
import { rememberedSectionHeight, SectionLoading } from './DeferredSections'
import { SectionNavigation } from './SectionNavigation'
import './controls.css'
import './models.css'

void import('./ProvidersSection').catch(() => {
  /* The section boundary owns the visible failure. */
})

const ModelsApp = lazy(async () => {
  const module = await import('./panel')
  return { default: module.ModelsApp }
})

// The panel boots once and keeps no module state besides the bridge it
// renders with. What throws on the way reaches the host's log (M39): a
// render the boundary caught, an error or a rejected promise nothing
// handled, a host message — all through the same bridge as the chat panel.
function startModelsPanel(root: Element, bridge: HostBridge): void {
  const report = reportPageFailures(bridge)
  createRoot(root).render(
    <PageBoundary
      crashed={{
        className: 'models-panel',
        title: UI_TEXT.modelsPanelTitle,
        message: UI_TEXT.modelsPanelUnavailable,
      }}
      onError={(error) => {
        report('render', error)
      }}
    >
      <DeferredSurface
        isModal={false}
        fallback={
          <>
            {rememberedSectionHeight(bridge, 'providers') === undefined && (
              <p className="models-visually-hidden" role="status" data-deferred-loading>
                {UI_TEXT.loadingOutput}
              </p>
            )}
            <div
              className="models-panel"
              style={{
                visibility:
                  rememberedSectionHeight(bridge, 'providers') === undefined ? 'hidden' : undefined,
              }}
            >
              <SectionNavigation activeId="providers" />
              <div className="models-section-slot">
                <SectionLoading section="providers" host={bridge} />
              </div>
            </div>
          </>
        }
      >
        <ModelsApp host={bridge} report={report} />
      </DeferredSurface>
    </PageBoundary>,
  )
}

const rootElement = document.querySelector(`#${WEBVIEW_ROOT_ELEMENT_ID}`)
if (rootElement === null) {
  throw new Error(`Webview root element #${WEBVIEW_ROOT_ELEMENT_ID} is missing`)
}
startModelsPanel(rootElement, vsCodeHostBridge(window))
