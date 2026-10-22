// An explicit Devices document has its own validated message channel, without
// the chat store, credential read or model probe.
import {
  Component,
  lazy,
  Suspense,
  type ReactNode,
  type ComponentType,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import * as z from 'zod/mini'
import { DEVICE_LIMITS, UI_TEXT } from '../../../../shared/constants'
import {
  parseDeviceHostMessage,
  parseDeviceReplyCorrelation,
  type DeviceHostMessage,
  type DeviceViewSource,
  type DevicesPanelPort,
  type DeviceWebviewMessage,
} from '../../../../shared/devicesPanel'
import type { QrEncoder } from '../devices/qr/encoder'
import type { MessageSource } from '../../../hostBridge'
import { DevicesView } from './DevicesView'
import { DeviceDraftContext, type DeviceDraftStore } from './deviceDraft'

interface DevicesAppProps {
  readonly qrEncoder?: QrEncoder
  /** The QR figure, loaded with the document: drawn with its invitation, no lazy hop. */
  readonly qrFigure?: ComponentType<QrProps>
  /** The QR code's own chunks failed to load: the QR spot offers a reload. */
  readonly isQrUnavailable?: boolean
  readonly loadQr?: QrLoader
  /** Reloads the document; a failed module fetch stays failed until then. */
  readonly reload?: () => void
  /** Keeps the unsent peer-invitation draft across that reload. */
  readonly draft?: DeviceDraftStore
  readonly messages: MessageSource
  readonly postMessage: (message: DeviceWebviewMessage) => void
}

interface QrProps {
  readonly text: string
  readonly encode: QrEncoder | undefined
}
type QrLoader = () => Promise<{ default: ComponentType<QrProps> }>
const loadQrFigure: QrLoader = () => import('../devices/qr/QrFigure')
function reloadDocument(): void {
  window.location.reload()
}

interface QrRecovery {
  /** A Devices request is waiting for its reply: a reload now would lose that reply. */
  readonly isBusy: boolean
  readonly reload: () => void
}

// A QR chunk that failed to load says so where the QR belongs. The browser
// keeps a failed module fetch for the document's lifetime, so Retry reloads
// the document: offered only while no request waits for its reply, and
// saying what a reload keeps (the pasted draft) and what Pair shows again.
function QrLoadFailure({ isBusy, reload }: QrRecovery) {
  return (
    <div role="alert">
      <p>{UI_TEXT.devices.qrReload}</p>
      <button type="button" disabled={isBusy} onClick={reload}>
        {UI_TEXT.surfaceLoadRetry}
      </button>
    </div>
  )
}

// Each invitation reply owns a fresh lazy intent. Text remains usable during
// loading/failure; a failed chunk recovers through the document reload.
class QrBoundary extends Component<QrProps & QrRecovery & { readonly load: QrLoader }> {
  public static getDerivedStateFromError() {
    return { failed: true }
  }
  public override state = { failed: false, Figure: lazy(this.props.load) }
  public override render() {
    const Figure = this.state.Figure
    return this.state.failed ? (
      <QrLoadFailure isBusy={this.props.isBusy} reload={this.props.reload} />
    ) : (
      <Suspense fallback={<p role="status">{UI_TEXT.loadingOutput}</p>}>
        <Figure text={this.props.text} encode={this.props.encode} />
      </Suspense>
    )
  }
}

export function DevicesApp(props: DevicesAppProps) {
  return (
    <DevicesErrorBoundary>
      <DevicesDocument {...props} />
    </DevicesErrorBoundary>
  )
}

// What the Devices document keeps in its webview state across a reload: the
// unsent peer-invitation draft (public text, never a key).
const savedDevicesState = z.object({
  devicesDraft: z.string().check(z.maxLength(DEVICE_LIMITS.invitationTextChars)),
})

/** The part of VS Code's webview API (`acquireVsCodeApi()`) the Devices surface uses. */
export interface DevicesWebviewApi {
  postMessage(message: DeviceWebviewMessage): void
  getState(): unknown
  setState(state: { readonly devicesDraft: string }): unknown
}

interface QrChunks {
  readonly encoder: QrEncoder
  readonly figure: ComponentType<QrProps>
}
type QrChunkLoader = () => Promise<QrChunks>
const loadQrChunks: QrChunkLoader = async () => {
  const [{ qrGeneratorEncoder }, { default: figure }] = await Promise.all([
    import('../devices/qr/qrGeneratorEncoder'),
    import('../devices/qr/QrFigure'),
  ])
  return { encoder: qrGeneratorEncoder, figure }
}

interface DevicesSurfaceProps {
  readonly api: DevicesWebviewApi
  readonly messages?: MessageSource
  readonly loadQr?: QrChunkLoader
}

/**
The Devices document as the webview entry mounts it. It lives in this lazy
chunk, not in main.tsx, so no surface's startup carries it. The approved
encoder and the QR figure load as soon as this chunk runs and the figure is
handed over loaded, so a QR draws in the same render as its invitation.
Without them the text invitation still works; a chunk that fails to load
says so at the QR, and its Retry reloads the document (the browser keeps a
failed module fetch until then).
*/
export function DevicesSurface({
  api,
  messages = window,
  loadQr = loadQrChunks,
}: DevicesSurfaceProps) {
  const [qr, setQr] = useState<'loading' | 'failed' | QrChunks>('loading')
  // One callback for the document's lifetime: the Devices bridge, and every
  // request waiting on it, belongs to this callback, so a render that only
  // adds the QR chunks (or their load failure) never cancels an action.
  const postMessage = useMemo(
    () => (message: DeviceWebviewMessage) => {
      api.postMessage(message)
    },
    [api],
  )
  // The unsent peer-invitation draft is kept in this document's webview
  // state, so a reload (the QR chunk's recovery) never loses it.
  const draft = useMemo<DeviceDraftStore>(() => {
    const saved = savedDevicesState.safeParse(api.getState())
    return {
      initial: saved.success ? saved.data.devicesDraft : '',
      save: (text) => {
        api.setState({ devicesDraft: text })
      },
    }
  }, [api])
  useEffect(() => {
    let isMounted = true
    void loadQr()
      .then((chunks) => {
        if (isMounted) setQr(chunks)
      })
      .catch(() => {
        if (isMounted) setQr('failed')
      })
    return () => {
      isMounted = false
    }
  }, [loadQr])
  return (
    <DevicesApp
      messages={messages}
      draft={draft}
      {...(qr === 'failed' ? { isQrUnavailable: true } : {})}
      {...(qr !== 'loading' && qr !== 'failed'
        ? { qrEncoder: qr.encoder, qrFigure: qr.figure }
        : {})}
      postMessage={postMessage}
    />
  )
}

class DevicesErrorBoundary extends Component<{ readonly children: ReactNode }> {
  public static getDerivedStateFromError() {
    return { failed: true }
  }
  public override state = { failed: false }
  public override render() {
    return this.state.failed ? (
      <main className="devices-view">
        <h1>{UI_TEXT.devices.title}</h1>
        <p role="alert">{UI_TEXT.devices.renderUnavailable}</p>
        <button
          type="button"
          onClick={() => {
            window.location.reload()
          }}
        >
          {UI_TEXT.crashReload}
        </button>
      </main>
    ) : (
      this.props.children
    )
  }
}

function DevicesDocument({
  messages,
  postMessage,
  qrEncoder,
  qrFigure: Figure,
  isQrUnavailable = false,
  loadQr = loadQrFigure,
  reload = reloadDocument,
  draft,
}: DevicesAppProps) {
  const [message, setMessage] = useState<DeviceHostMessage>({
    type: 'deviceState',
    revision: 0,
    state: { enabled: false },
  })
  // Requests posted and not yet settled; a reload is never offered over one.
  const [waiting, setWaiting] = useState(0)
  const latestRevision = useRef(0)
  const bridge = useMemo(() => {
    const views = new Map<string, AbortSignal>()
    const pending = new Map<
      string,
      {
        resolve: (message: DeviceHostMessage) => void
        reject: (error: Error) => void
        viewId: string
      }
    >()
    const port: DevicesPanelPort = {
      request: (request, signal) =>
        new Promise((resolve, reject) => {
          if (signal === undefined || signal.aborted) {
            reject(new Error('invalid-device-message'))
            return
          }
          views.set(request.viewId, signal)
          const abort = () => {
            if (views.get(request.viewId) === signal) views.delete(request.viewId)
            pending.get(request.requestId)?.reject(new Error('invalid-device-message'))
          }
          signal.addEventListener('abort', abort, { once: true })
          setWaiting((count) => count + 1)
          const settle = () => {
            if (pending.delete(request.requestId)) setWaiting((count) => count - 1)
          }
          pending.set(request.requestId, {
            viewId: request.viewId,
            resolve: (response) => {
              settle()
              resolve(response)
            },
            reject: (error) => {
              settle()
              reject(error)
            },
          })
          try {
            postMessage(request)
          } catch {
            pending.get(request.requestId)?.reject(new Error('invalid-device-message'))
          }
        }),
    }
    return { port, pending, views }
  }, [postMessage])
  const accept = (response: DeviceHostMessage, source: DeviceViewSource) => {
    if (
      source.signal.aborted ||
      response.setup?.viewId !== source.viewId ||
      bridge.views.get(source.viewId) !== source.signal ||
      response.revision <= latestRevision.current
    )
      return false
    latestRevision.current = response.revision
    setMessage(response)
    return true
  }
  // Subscribe during commit, before an external host can observe the painted view.
  useLayoutEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      const result = parseDeviceHostMessage(event.data)
      if (!result.ok) {
        const correlation = parseDeviceReplyCorrelation(event.data)
        const waiting =
          correlation === undefined ? undefined : bridge.pending.get(correlation.requestId)
        if (waiting !== undefined && waiting.viewId === correlation?.viewId)
          waiting.reject(new Error('invalid-device-message'))
        return
      }
      const response = result.message
      const requestId = response.setup?.requestId
      if (requestId !== undefined) {
        const waiting = bridge.pending.get(requestId)
        const signal =
          response.setup === undefined ? undefined : bridge.views.get(response.setup.viewId)
        if (signal !== undefined && !signal.aborted && waiting?.viewId === response.setup?.viewId)
          waiting?.resolve(response)
      } else if (response.revision > latestRevision.current) {
        latestRevision.current = response.revision
        setMessage(response)
      }
    }
    messages.addEventListener('message', receive)
    postMessage({ type: 'devicesReady' })
    return () => {
      messages.removeEventListener('message', receive)
      for (const waiting of bridge.pending.values())
        waiting.reject(new Error('invalid-device-message'))
      bridge.pending.clear()
      bridge.views.clear()
    }
  }, [bridge, messages, postMessage])
  // Text-only without an encoder; the QR spot reports a failed QR chunk load.
  const recovery: QrRecovery = { isBusy: waiting > 0, reload }
  let renderQr: ((text: string) => ReactNode) | undefined
  if (qrEncoder !== undefined && Figure !== undefined)
    renderQr = (text) => <Figure text={text} encode={qrEncoder} />
  else if (qrEncoder !== undefined)
    renderQr = (text) => (
      <QrBoundary
        key={message.setup?.requestId}
        text={text}
        encode={qrEncoder}
        load={loadQr}
        {...recovery}
      />
    )
  else if (isQrUnavailable) renderQr = () => <QrLoadFailure {...recovery} />
  return (
    <main>
      <DeviceDraftContext.Provider value={draft}>
        <DevicesView
          message={message}
          port={bridge.port}
          onState={accept}
          explicitSetup
          renderQr={renderQr}
        />
      </DeviceDraftContext.Provider>
    </main>
  )
}
