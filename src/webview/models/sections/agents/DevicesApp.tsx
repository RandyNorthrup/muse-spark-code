// An explicit Devices document has its own validated message channel, without
// the chat store, chat ready request, credential read or model probe.
import { Component, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DEVICE_LIMITS, UI_TEXT } from '../../../../shared/constants'
import {
  parseDeviceHostMessage,
  parseDeviceReplyRequestId,
  type DeviceHostMessage,
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
  const accept = (response: DeviceHostMessage) => {
    if (response.revision <= latestRevision.current) return
    latestRevision.current = response.revision
    setMessage(response)
  }
  const bridge = useMemo(() => {
    const pending = new Map<
      string,
      {
        resolve: (message: DeviceHostMessage) => void
        reject: (error: Error) => void
        action: DeviceWebviewRequest['action']
        revision: number
      }
    >()
    const port: DevicesPanelPort = {
      request: (request) =>
        new Promise((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            pending.delete(request.requestId)
            reject(new Error('invalid-device-message'))
          }, DEVICE_LIMITS.uiRequestTimeoutMs)
          pending.set(request.requestId, {
            action: request.action,
            revision: latestRevision.current,
            resolve: (response) => {
              window.clearTimeout(timeout)
              pending.delete(request.requestId)
              resolve(response)
            },
            reject: (error) => {
              window.clearTimeout(timeout)
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
    return { port, pending }
  }, [postMessage])
  // Subscribe during commit, before an external host can observe the painted view.
  useLayoutEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      const result = parseDeviceHostMessage(event.data)
      if (!result.ok) {
        const id = parseDeviceReplyRequestId(event.data)
        if (id !== undefined) bridge.pending.get(id)?.reject(new Error('invalid-device-message'))
        return
      }
      const response = result.message
      const requestId = response.setup?.requestId
      if (requestId !== undefined) {
        bridge.pending.get(requestId)?.resolve(response)
      } else if (response.revision > latestRevision.current) {
        latestRevision.current = response.revision
        setMessage(response)
        for (const waiting of bridge.pending.values()) {
          if (response.revision <= waiting.revision) continue
          const pairId = 'pairId' in waiting.action ? waiting.action.pairId : undefined
          if (
            pairId !== undefined &&
            (!response.state.enabled ||
              response.state.devices.every((device) => device.pairId !== pairId))
          )
            continue
          waiting.reject(new Error('invalid-device-message'))
        }
      }
    }
    messages.addEventListener('message', receive)
    return () => {
      messages.removeEventListener('message', receive)
      for (const waiting of bridge.pending.values())
        waiting.reject(new Error('invalid-device-message'))
      bridge.pending.clear()
    }
  }, [bridge, messages])
  return (
    <main>
      <DevicesView message={message} port={bridge.port} onState={accept} explicitSetup />
    </main>
  )
}
