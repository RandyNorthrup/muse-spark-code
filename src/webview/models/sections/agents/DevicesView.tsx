// Shared Devices section: VS Code, companion and native web views inject the
// same port. Nothing here activates a receiver or reads credentials on mount.
import { type ReactNode, useRef, useState } from 'react'
import { UI_TEXT } from '../../../../shared/constants'
import { fill, formatUsd } from '../../../../shared/l10n/text'
import {
  parseDeviceHostMessage,
  parseDeviceWebviewRequest,
  type DeviceHostMessage,
  type DevicesPanelPort,
} from '../../../../shared/modelsPanel'
import { DeviceTaskDetails, type DeviceTaskView } from './DeviceTaskDetails'
import { DeviceCard, type DeviceBoardBinding } from './DeviceCard'
import { DevicePairing, type DeviceAction } from './DevicePairing'
import { deviceFailureText } from './devicePresentation'
import './devices.css'

export function DevicesView({
  message,
  port,
  onState,
  explicitSetup = false,
  boards = [],
  renderQr,
  paid,
  tasks = [],
}: {
  readonly message: DeviceHostMessage
  readonly port: DevicesPanelPort
  readonly onState: (message: DeviceHostMessage) => void
  readonly explicitSetup?: boolean
  readonly boards?: readonly DeviceBoardBinding[]
  readonly renderQr?: ((publicText: string) => ReactNode) | undefined
  readonly tasks?: readonly DeviceTaskView[]
  readonly paid?: { readonly price: string; readonly budgetUsd: number }
}) {
  const activeRequest = useRef<string | undefined>(undefined)
  const [setupTarget, setSetupTarget] = useState<{ requestId: string; pairId: string }>()
  const [busy, setBusy] = useState(false)
  const [isInvalid, setInvalid] = useState(false)
  const parsed = parseDeviceHostMessage(message)
  if (!parsed.ok) return <p role="alert">{UI_TEXT.devices.invalidMessage}</p>
  const { state, setup } = parsed.message
  if (
    !explicitSetup &&
    (!state.enabled || state.devices.every((device) => device.offers.length === 0))
  )
    return null

  const send = async (action: DeviceAction): Promise<DeviceHostMessage | undefined> => {
    if (activeRequest.current !== undefined) return undefined
    let requestId: string
    try {
      requestId = crypto.randomUUID().replaceAll('-', '')
    } catch {
      setInvalid(true)
      return undefined
    }
    const request = parseDeviceWebviewRequest({ type: 'deviceRequest', requestId, action })
    if (!request.ok) {
      setInvalid(true)
      return undefined
    }
    activeRequest.current = requestId
    setBusy(true)
    setInvalid(false)
    try {
      const response = parseDeviceHostMessage(await port.request(request.message))
      if (!response.ok || response.message.setup?.requestId !== requestId) {
        setInvalid(true)
        return undefined
      }
      setSetupTarget('pairId' in action ? { requestId, pairId: action.pairId } : undefined)
      onState(response.message)
      return response.message
    } catch {
      setInvalid(true)
      return undefined
    } finally {
      activeRequest.current = undefined
      setBusy(false)
    }
  }
  return (
    <section className="devices-view" aria-label={UI_TEXT.devices.title}>
      <h1>{UI_TEXT.devices.title}</h1>
      {!state.enabled && <p role="status">{UI_TEXT.devices.offHelp}</p>}
      <p>{UI_TEXT.devices.costOwnership}</p>
      {paid !== undefined && (
        <p>
          {fill(UI_TEXT.devices.paidHelp, {
            price: paid.price,
            budget: formatUsd(paid.budgetUsd, 2),
          })}
        </p>
      )}
      {setup?.failure !== undefined && <p role="alert">{deviceFailureText(setup.failure)}</p>}
      {isInvalid && <p role="alert">{UI_TEXT.devices.invalidMessage}</p>}
      {busy && <p role="status">{UI_TEXT.devices.working}</p>}
      <DevicePairing setup={setup} busy={busy} send={send} renderQr={renderQr} />
      {state.enabled && (
        <>
          <label>
            <input
              type="checkbox"
              checked={state.discoveryEnabled}
              disabled={busy}
              onChange={(event) => {
                void send({ kind: 'setDiscovery', enabled: event.currentTarget.checked })
              }}
            />
            {UI_TEXT.devices.discovery}
          </label>
          <p>{UI_TEXT.devices.discoveryDescription}</p>
          {state.devices.map((device) => (
            <DeviceCard
              key={device.pairId}
              device={device}
              setup={
                setup?.requestId === setupTarget?.requestId && device.pairId === setupTarget?.pairId
                  ? setup
                  : undefined
              }
              isUnsupportedHost={setup?.failure === 'unsupported-host'}
              boards={boards}
              busy={busy}
              send={send}
            />
          ))}
          {tasks.map((task) => {
            const device = state.devices.find(
              (row) => row.pairId === task.route.pairId && row.deviceId === task.route.deviceId,
            )
            return device === undefined ? null : (
              <DeviceTaskDetails key={task.taskId} input={task} deviceLabel={device.label} />
            )
          })}
        </>
      )}
    </section>
  )
}
