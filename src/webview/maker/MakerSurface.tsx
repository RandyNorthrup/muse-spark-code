import { createRoot } from 'react-dom/client'
import {
  type ReactNode,
  lazy,
  Suspense,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from 'react'
import { MAKER_PROTOCOL_VERSION, UI_TEXT, WEBVIEW_ROOT_ELEMENT_ID } from '../../shared/constants'
import type { MakerSurfaceMessage } from '../../shared/makerProtocol'
import type { HostBridge } from '../hostBridge'
import { Modal } from '../components/Modal'
import { createMakerStore } from './store'
import { makerWarningText } from './presentation'
import { StopChip } from './StopChip'
import { PayloadReview } from './PayloadReview'
import { MakerBoundary } from './MakerBoundary'
import './maker.css'

const loadApproval = async () => {
  const { ApprovalDialog } = await import('./ApprovalDialog')
  return { default: ApprovalDialog }
}
const loadDevices = async () => {
  const { DevicePanel } = await import('./DevicePanel')
  return { default: DevicePanel }
}
const loadWizard = async () => {
  const { MachineWizard } = await import('./MachineWizard')
  return { default: MachineWizard }
}
const loadLog = async () => {
  const { DeviceLog } = await import('./DeviceLog')
  return { default: DeviceLog }
}
const createViews = () => ({
  ApprovalDialog: lazy(loadApproval),
  DevicePanel: lazy(loadDevices),
  MachineWizard: lazy(loadWizard),
  DeviceLog: lazy(loadLog),
})

export function MakerSurface({ store }: { readonly store: ReturnType<typeof createMakerStore> }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [view, setView] = useState<'devices' | 'wizard' | 'log' | undefined>()
  const [closedPreview, setClosedPreview] = useState<unknown>()
  const [views, setViews] = useState(createViews)
  const { ApprovalDialog, DevicePanel, MachineWizard, DeviceLog } = views
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
          stop={stop}
          onRendered={(digest) => {
            store.previewRendered(approval.id, digest)
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
        {stop}
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
        onRetry={() => {
          setViews(createViews())
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
            >
              {stop}
              <p role="status" data-deferred-loading>
                {UI_TEXT.loadingOutput}
              </p>
            </Modal>
          }
        >
          {overlay}
        </Suspense>
        {state.preview !== undefined &&
          closedPreview !== state.preview &&
          approval === undefined &&
          view === undefined && (
            <Modal
              title={state.preview.preview.title}
              titleId="maker-preview-title"
              onClose={() => {
                setClosedPreview(state.preview)
              }}
            >
              {stop}
              {state.preview.preview.kind === 'payload' ? (
                <PayloadReview
                  content={state.preview.preview.content}
                  encoding={state.preview.preview.encoding}
                  onRendered={(digest) => {
                    const preview = state.preview?.preview
                    if (preview?.kind === 'payload' && preview.id !== undefined)
                      store.previewRendered(preview.id, digest)
                  }}
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
      </MakerBoundary>
    </div>
  )
}

/** V/R/companion use the same bridge. No surface persists grants or log data. */
export function mountMaker(
  element: Element,
  host: HostBridge<MakerSurfaceMessage>,
  pending: readonly unknown[] = [],
) {
  const store = createMakerStore(host)
  for (const message of pending) store.receive(message)
  const root = createRoot(element)
  root.render(<MakerSurface store={store} />)
  return {
    receive: store.receive,
    dispose: () => {
      store.dispose()
      root.unmount()
      element.remove()
    },
  }
}
