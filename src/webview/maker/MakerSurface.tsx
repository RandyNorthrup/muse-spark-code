import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import {
  type ReactNode,
  lazy,
  Suspense,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  MAKER_PROTOCOL_VERSION,
  PANEL_RELOAD_EVENT,
  UI_TEXT,
  WEBVIEW_ROOT_ELEMENT_ID,
} from '../../shared/constants'
import type { MakerSurfaceMessage } from '../../shared/makerProtocol'
import type { HostBridge } from '../hostBridge'
import { Modal } from '../components/Modal'
import type { createMakerStore } from './store'
import { makerWarningText } from './presentation'
import { StopChip } from './StopChip'
import { MakerBoundary } from './MakerBoundary'
import { DeviceLog } from './DeviceLog'
import { reloadPanelSurface } from '../reloadPanelSurface'
import './maker.css'

const loadDevices = async () => {
  const { DevicePanel } = await import('./DevicePanel')
  return { default: DevicePanel }
}
const createViews = () => ({ DevicePanel: lazy(loadDevices) })
const ApprovalDialog = lazy(async () => {
  const module = await import('./reviewEntry')
  return { default: module.ApprovalDialog }
})
const PayloadReview = lazy(async () => {
  const module = await import('./reviewEntry')
  return { default: module.PayloadReview }
})
const MachineWizard = lazy(async () => {
  const module = await import('./reviewEntry')
  return { default: module.MachineWizard }
})

export function MakerSurface({ store }: { readonly store: ReturnType<typeof createMakerStore> }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [view, setView] = useState<'devices' | 'wizard' | 'log' | undefined>()
  const [closedPreview, setClosedPreview] = useState<unknown>()
  const [views] = useState(createViews)
  const { DevicePanel } = views
  const approval = state.approvals[0]
  const close = () => {
    setView(undefined)
  }
  const isPreviewOpen =
    state.preview !== undefined &&
    closedPreview !== state.preview &&
    approval === undefined &&
    view === undefined
  const isModalOpen = approval !== undefined || view !== undefined || isPreviewOpen
  useLayoutEffect(() => {
    if (!isModalOpen) return
    const background = document.querySelector<HTMLElement>(`#${WEBVIEW_ROOT_ELEMENT_ID}`)
    const isPreviousInert = background?.inert ?? false
    const focus = document.activeElement
    if (background !== null) background.inert = true
    return () => {
      if (background !== null) background.inert = isPreviousInert
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus()
    }
  }, [isModalOpen])
  const stop = <StopChip machines={state.admission?.machines ?? []} send={store.send} />
  const overlay: ReactNode = (() => {
    if (approval !== undefined)
      return (
        <ApprovalDialog
          key={approval.id}
          request={approval}
          limits={
            state.admission?.machines.find(
              (machine) =>
                approval.target.kind === 'machine' &&
                machine.registrationId === approval.target.registrationId,
            )?.limits
          }
          stop={stop}
          onRendered={(digest) => {
            store.previewRendered(approval.id, digest)
          }}
          onReview={(digest) => {
            store.reviewCompleted(approval.id, digest)
          }}
          onAnswer={(decision) => {
            store.answer(approval.id, decision)
          }}
        />
      )
    if (view === 'devices')
      return (
        <DevicePanel
          state={state}
          stop={stop}
          send={store.send}
          onClose={close}
          onAdd={() => {
            setView('wizard')
          }}
        />
      )
    if (view === 'wizard')
      return (
        <MachineWizard
          stop={stop}
          send={store.send}
          onClose={() => {
            setView('devices')
          }}
        />
      )
    return view === 'log' ? <DeviceLog stop={stop} log={state.log} onClose={close} /> : null
  })()
  let notice: string | undefined
  if (typeof state.notice === 'string') notice = makerWarningText(state.notice)
  else if (state.notice?.type === 'makerNotice') notice = state.notice.message
  else notice = state.notice?.notices.join('\n')
  return (
    <div className="maker-surface">
      <div className="maker-toolbar" inert={isModalOpen}>
        {stop}
        <button
          type="button"
          onClick={() => {
            setView('devices')
          }}
        >
          {UI_TEXT.makerDevicesTitle}
        </button>
        <button
          type="button"
          onClick={() => {
            store.send({ v: MAKER_PROTOCOL_VERSION, type: 'makerOpenLog' })
            setView('log')
          }}
        >
          {UI_TEXT.makerOpenDeviceLog}
        </button>
      </div>
      {state.notice !== undefined && <p role="status">{notice}</p>}
      {state.result !== undefined && (
        <p role="status">
          {state.result.message}
          {state.result.outcome === 'sentOutcomeUnknown' && <> {UI_TEXT.makerSentOutcomeUnknown}</>}
          {state.result.outcome === 'sentWithUnrecordedAudit' && (
            <> {UI_TEXT.makerAuditUnrecorded}</>
          )}
        </p>
      )}
      <MakerBoundary
        stop={stop}
        onClose={() => {
          close()
          setClosedPreview(state.preview)
          if (approval !== undefined) store.answer(approval.id, 'reject_once')
        }}
        onRetry={() => {
          reloadPanelSurface()
        }}
      >
        <Suspense
          fallback={
            <Modal
              title={UI_TEXT.loadingOutput}
              titleId="maker-loading-title"
              onClose={() => {
                if (approval === undefined) {
                  close()
                } else {
                  store.answer(approval.id, 'reject_once')
                }
              }}
              fixedControls={stop}
            >
              <p role="status" data-deferred-loading>
                {UI_TEXT.loadingOutput}
              </p>
            </Modal>
          }
        >
          {overlay}
          {state.preview !== undefined && isPreviewOpen && (
            <Modal
              title={state.preview.preview.title}
              titleId="maker-preview-title"
              onClose={() => {
                setClosedPreview(state.preview)
              }}
              fixedControls={stop}
            >
              {state.preview.preview.kind === 'payload' ? (
                <PayloadReview
                  content={state.preview.preview.content}
                  encoding={state.preview.preview.encoding}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (state.preview?.preview.kind === 'stl')
                      store.send({
                        v: MAKER_PROTOCOL_VERSION,
                        type: 'makerOpenPreview',
                        artifactId: state.preview.preview.artifactId,
                      })
                  }}
                >
                  {UI_TEXT.makerPreviewTitle}
                </button>
              )}
            </Modal>
          )}
        </Suspense>
      </MakerBoundary>
    </div>
  )
}

/** V/R/companion use the same bridge. No surface persists grants or log data. */
export async function mountMaker(
  element: Element,
  host: HostBridge<MakerSurfaceMessage>,
  pending: readonly unknown[] = [],
) {
  const { createMakerStore, installMakerTable } = await import('./reviewEntry')
  installMakerTable()
  const store = createMakerStore(host)
  let isReloading = false
  const reloading = () => {
    isReloading = true
  }
  window.addEventListener(PANEL_RELOAD_EVENT, reloading)
  for (const message of pending) store.receive(message)
  const root = createRoot(element)
  // The loader may remove the static shell only after React has committed Stop.
  flushSync(() => {
    root.render(<MakerSurface store={store} />)
  })
  return {
    receive: store.receive,
    dispose: () => {
      window.removeEventListener(PANEL_RELOAD_EVENT, reloading)
      store.dispose(!isReloading)
      root.unmount()
      element.remove()
    },
  }
}
