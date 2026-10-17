// Shared Devices section: VS Code, companion and native web views inject the
// same port. Nothing here activates a receiver or reads credentials on mount.
import { Fragment, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { DEVICE_LIMITS, UI_TEXT } from '../../../../shared/constants'
import { fill } from '../../../../shared/l10n/text'
import { formatUsd } from '../../../../shared/l10n/exactUsd'
import {
  parseDeviceHostMessage,
  parseDeviceWebviewRequest,
  type DeviceHostMessage,
  type DeviceActionResult,
  type DeviceViewSource,
  type DevicesPanelPort,
} from '../../../../shared/devicesPanel'
import { DeviceTaskDetails, type DeviceTaskView } from './DeviceTaskDetails'
import { DeviceCard, type DeviceBoardBinding } from './DeviceCard'
import { DevicePairing, type DeviceAction } from './DevicePairing'
import { deviceFailureText } from './devicePresentation'
// M100 phase 2 (lane U): phase-2 views mount here; lane W wires the real host
// values behind the setup facts, fakes stand in until then.
import { DiscoveryDetails } from '../devices/discovery/DiscoveryDetails'
import { OwnerGrants } from '../devices/grants/OwnerGrants'
import { ActionPrompts } from '../devices/prompts/ActionPrompts'
import { PowerView } from '../devices/power/PowerView'
import { BlockedSetup } from '../devices/setup/BlockedSetup'
import './devices.css'

function newViewId(): string {
  return crypto.randomUUID().replaceAll('-', '')
}

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
  readonly onState: (message: DeviceHostMessage, source: DeviceViewSource) => boolean
  readonly explicitSetup?: boolean
  readonly boards?: readonly DeviceBoardBinding[]
  readonly renderQr?: ((publicText: string) => ReactNode) | undefined
  readonly tasks?: readonly DeviceTaskView[]
  readonly paid?: { readonly price: string; readonly budgetUsd: number }
}) {
  const lifetime = useRef<{ viewId?: string; controller: AbortController } | undefined>(undefined)
  const activeRequest = useRef<
    | {
        id: string
        revision: number
        action: DeviceAction
        cancel: (reason: 'stale' | 'failed' | 'aborted') => void
      }
    | undefined
  >(undefined)
  useLayoutEffect(() => {
    const live = { controller: new AbortController() }
    lifetime.current = live
    return () => {
      activeRequest.current?.cancel('aborted')
      live.controller.abort()
      lifetime.current = undefined
    }
  }, [])
  const latestRevision = useRef(message.revision)
  const [snapshot, setSnapshot] = useState(message)
  const [setupTarget, setSetupTarget] = useState<{ requestId: string; pairId: string }>()
  const retryOpener = useRef<HTMLElement | null>(null)
  const view = useRef<HTMLElement>(null)
  const [canRetry, setRetry] = useState(false)
  const [busy, setBusy] = useState(false)
  const [isInvalid, setInvalid] = useState(false)
  const incoming = parseDeviceHostMessage(message)
  if (incoming.ok && incoming.message.revision > snapshot.revision) setSnapshot(incoming.message)
  useLayoutEffect(() => {
    latestRevision.current = snapshot.revision
    const waiting = activeRequest.current
    if (waiting === undefined || snapshot.revision <= waiting.revision) return
    const pairId = 'pairId' in waiting.action ? waiting.action.pairId : undefined
    if (
      pairId !== undefined &&
      (!snapshot.state.enabled ||
        snapshot.state.devices.every((device) => device.pairId !== pairId))
    )
      return
    waiting.cancel('stale')
  }, [snapshot])
  const parsed = parseDeviceHostMessage(snapshot)
  if (!parsed.ok) return <p role="alert">{UI_TEXT.devices.invalidMessage}</p>
  const { state, setup } = parsed.message
  if (
    !explicitSetup &&
    (!state.enabled || state.devices.every((device) => device.offers.length === 0))
  )
    return null

  // Both surfaces use this helper; transport ports never supply action success.
  const send = async (action: DeviceAction): Promise<DeviceActionResult> => {
    const live = lifetime.current
    if (live === undefined || live.controller.signal.aborted)
      return { ok: false, reason: 'aborted' }
    if (activeRequest.current !== undefined) return { ok: false, reason: 'busy' }
    let requestId: string
    try {
      live.viewId ??= newViewId()
      requestId = newViewId()
    } catch {
      setInvalid(true)
      return { ok: false, reason: 'failed' }
    }
    const request = parseDeviceWebviewRequest({
      type: 'deviceRequest',
      viewId: live.viewId,
      requestId,
      revision: latestRevision.current,
      action,
    })
    if (!request.ok) {
      setInvalid(true)
      return { ok: false, reason: 'failed' }
    }
    const controller = new AbortController()
    const signal = AbortSignal.any([live.controller.signal, controller.signal])
    const isCurrentWait = () =>
      lifetime.current === live && !signal.aborted && activeRequest.current?.id === requestId
    let cancellation: 'stale' | 'failed' | 'aborted' = 'aborted'
    let timeout: number | undefined
    let rejectAbort: (() => void) | undefined
    const cancel = (reason: typeof cancellation) => {
      cancellation = reason
      window.clearTimeout(timeout)
      controller.abort()
      if (activeRequest.current?.id !== requestId) return
      activeRequest.current = undefined
      if (reason === 'aborted') {
        return
      }

      setBusy(false)
      setInvalid(true)
    }
    activeRequest.current = { id: requestId, revision: request.message.revision, action, cancel }
    // Retry returns to this control; only its current handler may submit again.
    // Replaying saved actions could bypass a changed comparison/Resume choice.
    retryOpener.current =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null
    setRetry(true)
    setBusy(true)
    setInvalid(false)
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAbort = () => {
          reject(new Error('invalid-device-message'))
        }
        signal.addEventListener('abort', rejectAbort, { once: true })
        timeout = window.setTimeout(() => {
          cancel('failed')
        }, DEVICE_LIMITS.uiRequestTimeoutMs)
      })
      const reply = await Promise.race([port.request(request.message, signal), aborted])
      if (!isCurrentWait()) return { ok: false, reason: cancellation }
      const response = parseDeviceHostMessage(reply)
      if (
        !response.ok ||
        response.message.setup?.requestId !== requestId ||
        response.message.setup.viewId !== live.viewId
      ) {
        setInvalid(true)
        return { ok: false, reason: 'failed' }
      }
      if (response.message.revision <= latestRevision.current) {
        setInvalid(true)
        return { ok: false, reason: 'stale' }
      }
      if (!onState(response.message, { viewId: live.viewId, signal })) {
        setInvalid(true)
        return { ok: false, reason: 'stale' }
      }
      latestRevision.current = response.message.revision
      setSetupTarget('pairId' in action ? { requestId, pairId: action.pairId } : undefined)
      setSnapshot(response.message)
      return response.message.setup.failure === undefined
        ? { ok: true, message: response.message }
        : { ok: false, reason: 'failed' }
    } catch {
      if (isCurrentWait()) {
        setInvalid(true)
        return { ok: false, reason: 'failed' }
      }
      return { ok: false, reason: cancellation }
    } finally {
      window.clearTimeout(timeout)
      if (rejectAbort !== undefined) signal.removeEventListener('abort', rejectAbort)
      if (isCurrentWait()) {
        activeRequest.current = undefined
        setBusy(false)
      }
      controller.abort()
    }
  }
  return (
    <section ref={view} tabIndex={-1} className="devices-view" aria-label={UI_TEXT.devices.title}>
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
      {isInvalid && (
        <div>
          <p role="alert">{UI_TEXT.devices.invalidMessage}</p>
          {canRetry && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setInvalid(false)
                setRetry(false)
                const opener = retryOpener.current
                if (opener?.isConnected && !opener.matches(':disabled')) opener.focus()
                else view.current?.focus()
              }}
            >
              {UI_TEXT.devices.retry}
            </button>
          )}
        </div>
      )}
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
          {setup?.discovery !== undefined && (
            <DiscoveryDetails serviceId={setup.discovery.serviceId} port={setup.discovery.port} />
          )}
          {(setup?.capability !== undefined || setup?.throttled !== undefined) && (
            <PowerView capability={setup.capability} throttled={setup.throttled} />
          )}
          {state.devices.map((device) => {
            // Phase-2 sections read the same action-bound setup as the card:
            // an unbound (foreign) setup never supplies view state.
            const boundSetup =
              setup?.requestId === setupTarget?.requestId && device.pairId === setupTarget?.pairId
                ? setup
                : undefined
            return (
              <Fragment key={device.pairId}>
                <DeviceCard
                  device={device}
                  setup={boundSetup}
                  throttled={setup?.throttled}
                  isUnsupportedHost={setup?.failure === 'unsupported-host'}
                  boards={boards}
                  busy={busy}
                  send={send}
                />
                {(boundSetup?.owners !== undefined || boundSetup?.grantRefusal !== undefined) && (
                  <OwnerGrants
                    owners={boundSetup.owners}
                    busy={busy}
                    refusal={boundSetup.grantRefusal}
                    onRevoke={(ownerId, grantId) => {
                      void send({ kind: 'revokeGrant', pairId: device.pairId, ownerId, grantId })
                    }}
                  />
                )}
                {boundSetup?.stepUp !== undefined && <ActionPrompts deviceLabel={device.label} />}
                {device.status === 'blocked-or-unreachable' && (
                  <BlockedSetup
                    application={boundSetup?.listenerApplication ?? UI_TEXT.devices.unknown}
                    interfaceLabel={boundSetup?.interfaceLabel ?? UI_TEXT.devices.unknown}
                    address={device.endpoint.address}
                    port={device.endpoint.port}
                  />
                )}
              </Fragment>
            )
          })}
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
