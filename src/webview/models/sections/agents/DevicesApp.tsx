// An explicit Devices document has its own validated message channel, without
// the chat store, chat ready request, credential read or model probe.
import { Component, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { UI_TEXT } from '../../../../shared/constants'
import {
  parseDeviceHostMessage,
  parseDeviceReplyCorrelation,
  type DeviceHostMessage,
  type DeviceViewSource,
  type DevicesPanelPort,
  type DeviceWebviewRequest,
} from '../../../../shared/modelsPanel'
import type { MessageSource } from '../../../hostBridge'
import { DevicesView } from './DevicesView'

interface DevicesAppProps {
  readonly messages: MessageSource
  readonly postMessage: (message: DeviceWebviewRequest) => void
}

export function DevicesApp(props: DevicesAppProps) {
  return (
    <DevicesErrorBoundary>
      <DevicesDocument {...props} />
    </DevicesErrorBoundary>
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

function DevicesDocument({ messages, postMessage }: DevicesAppProps) {
  const [message, setMessage] = useState<DeviceHostMessage>({
    type: 'deviceState',
    revision: 0,
    state: { enabled: false },
  })
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
          pending.set(request.requestId, {
            viewId: request.viewId,
            resolve: (response) => {
              pending.delete(request.requestId)
              resolve(response)
            },
            reject: (error) => {
              pending.delete(request.requestId)
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
    return () => {
      messages.removeEventListener('message', receive)
      for (const waiting of bridge.pending.values())
        waiting.reject(new Error('invalid-device-message'))
      bridge.pending.clear()
      bridge.views.clear()
    }
  }, [bridge, messages])
  return (
    <main>
      <DevicesView message={message} port={bridge.port} onState={accept} explicitSetup />
    </main>
  )
}
