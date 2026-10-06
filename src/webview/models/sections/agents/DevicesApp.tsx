// An explicit Devices document has its own validated message channel, without
// the chat store, chat ready request, credential read or model probe.
import { useLayoutEffect, useMemo, useState } from 'react'
import {
  parseDeviceHostMessage,
  type DeviceHostMessage,
  type DevicesPanelPort,
  type DeviceWebviewRequest,
} from '../../../../shared/modelsPanel'
import type { MessageSource } from '../../../hostBridge'
import { DevicesView } from './DevicesView'

export function DevicesApp({
  messages,
  postMessage,
}: {
  readonly messages: MessageSource
  readonly postMessage: (message: DeviceWebviewRequest) => void
}) {
  const [message, setMessage] = useState<DeviceHostMessage>({
    type: 'deviceState',
    state: { enabled: false },
  })
  const bridge = useMemo(() => {
    const pending = new Map<
      string,
      { resolve: (message: DeviceHostMessage) => void; reject: (error: Error) => void }
    >()
    const port: DevicesPanelPort = {
      request: (request) =>
        new Promise((resolve, reject) => {
          pending.set(request.requestId, { resolve, reject })
          try {
            postMessage(request)
          } catch {
            pending.delete(request.requestId)
            reject(new Error('invalid-device-message'))
          }
        }),
    }
    return { port, pending }
  }, [postMessage])
  // Subscribe during commit, before an external host can observe the painted view.
  useLayoutEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      const result = parseDeviceHostMessage(event.data)
      if (!result.ok) return
      const response = result.message
      const requestId = response.setup?.requestId
      const waiting = requestId === undefined ? undefined : bridge.pending.get(requestId)
      if (waiting !== undefined && requestId !== undefined) {
        bridge.pending.delete(requestId)
        waiting.resolve(response)
      } else if (requestId === undefined) {
        setMessage(response)
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
      <DevicesView message={message} port={bridge.port} onState={setMessage} explicitSetup />
    </main>
  )
}
