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
import './maker.css'

const ApprovalDialog = lazy(async () => {
  const { ApprovalDialog } = await import('./ApprovalDialog')
  return { default: ApprovalDialog }
})
const StopChip = lazy(async () => {
  const { StopChip } = await import('./StopChip')
  return { default: StopChip }
})
const DevicePanel = lazy(async () => {
  const { DevicePanel } = await import('./DevicePanel')
  return { default: DevicePanel }
})
const MachineWizard = lazy(async () => {
  const { MachineWizard } = await import('./MachineWizard')
  return { default: MachineWizard }
})
const DeviceLog = lazy(async () => {
  const { DeviceLog } = await import('./DeviceLog')
  return { default: DeviceLog }
})

export function MakerSurface({ store }: { readonly store: ReturnType<typeof createMakerStore> }) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [view, setView] = useState<'devices' | 'wizard' | 'log' | undefined>()
  const [closedPreview, setClosedPreview] = useState<unknown>()
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
  const stop = (
    <div className="maker-stop-slot">
      <Suspense
        fallback={
          state.admission?.machines.length ? (
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                store.send({ v: MAKER_PROTOCOL_VERSION, type: 'makerStop' })
              }}
            >
              {UI_TEXT.makerStopAll}
            </button>
          ) : null
        }
      >
        <StopChip machines={state.admission?.machines ?? []} send={store.send} />
      </Suspense>
    </div>
  )
  let overlay: ReactNode = null
  if (approval === undefined) {
    switch (view) {
      case 'devices': {
        overlay = (
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
        break
      }
      case 'wizard': {
        overlay = (
          <MachineWizard
            stop={stop}
            send={store.send}
            onClose={() => {
              setView('devices')
            }}
          />
        )
        break
      }
      case 'log': {
        overlay = <DeviceLog stop={stop} log={state.log} onClose={close} />
        break
      }
      case undefined: {
        break
      }
    }
  } else {
    overlay = (
      <ApprovalDialog
        key={approval.id}
        request={approval}
        stop={stop}
        onAnswer={(decision) => {
          store.answer(approval.id, decision)
        }}
      />
    )
  }
  let notice: string | undefined
  if (typeof state.notice === 'string') notice = makerWarningText(state.notice)
  else if (state.notice?.type === 'makerNotice') notice = state.notice.message
  else notice = state.notice?.notices.join('\n')
  return (
    <div className="maker-surface">
      <div className="maker-toolbar" inert={isModalOpen}>
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            setView('devices')
          }}
        >
          {UI_TEXT.makerDevicesTitle}
        </button>
        <button
          type="button"
          className="button-secondary"
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
              <pre tabIndex={0}>{state.preview.preview.content}</pre>
            ) : (
              <button
                type="button"
                className="button-secondary"
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
