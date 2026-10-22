import { type ReactNode, useState } from 'react'
import {
  MAKER_PROTOCOL_VERSION,
  MAKER_SERIAL_DEFAULT_BAUD,
  MAKER_SERIAL_DEFAULT_DURATION_MS,
  UI_TEXT,
} from '../../shared/constants'
import { formatNumber, plural } from '../../shared/l10n/text'
import type { MakerHostMessage, MakerSurfaceMessage } from '../../shared/makerProtocol'
import { Modal } from '../components/Modal'
import type { createMakerStore } from './store'
import { makerWarningText } from './presentation'

export function DevicePanel({
  state,
  send,
  onClose,
  onAdd,
  stop,
}: {
  readonly stop: ReactNode
  readonly state: ReturnType<ReturnType<typeof createMakerStore>['getState']>
  readonly send: (message: MakerSurfaceMessage) => boolean
  readonly onClose: () => void
  readonly onAdd: () => void
}) {
  const admission = state.admission
  const [reason, setReason] = useState('')
  const isAllowed =
    admission?.isTrusted === true && admission.hardwareEnabled && admission.isInteractive
  const action = (label: string, message: MakerSurfaceMessage, isDisabled = false) => (
    <button
      type="button"
      disabled={isDisabled}
      onClick={() => {
        send(message)
      }}
    >
      {label}
    </button>
  )
  return (
    <Modal
      title={UI_TEXT.makerDevicesTitle}
      titleId="maker-devices-title"
      onClose={onClose}
      fixedControls={stop}
    >
      <p>{UI_TEXT.makerSoftwareStopWarning}</p>
      <p>
        {admission?.hardwareEnabled === true
          ? UI_TEXT.makerHardwareEnabled
          : UI_TEXT.makerHardwareDisabled}
      </p>
      {admission?.isTrusted !== true && <p role="note">{UI_TEXT.makerTrustRequired}</p>}
      {admission?.isInteractive === false && <p role="note">{UI_TEXT.makerUnattendedDenied}</p>}
      {admission?.hardwareEnabled === true ? (
        action(UI_TEXT.makerDisableHardware, {
          v: MAKER_PROTOCOL_VERSION,
          type: 'makerHardware',
          enabled: false,
        })
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            send({
              v: MAKER_PROTOCOL_VERSION,
              type: 'makerHardware',
              enabled: true,
              reason: reason.trim(),
            })
          }}
        >
          <label>
            {UI_TEXT.makerHardwareReason}
            <input
              value={reason}
              required
              onChange={(event) => {
                setReason(event.target.value)
              }}
            />
          </label>
          <button
            type="submit"
            disabled={
              admission?.isTrusted !== true || !admission.isInteractive || reason.trim() === ''
            }
          >
            {UI_TEXT.makerEnableHardware}
          </button>
        </form>
      )}
      <p>
        {plural(
          UI_TEXT.makerDeviceCount,
          (admission?.ports.length ?? 0) + (admission?.machines.length ?? 0),
        )}
      </p>
      {admission?.machines.map((machine) => (
        <section key={machine.registrationId}>
          <h3>{machine.name}</h3>
          <p>
            <code>{machine.kind}</code> · <code>{machine.endpoint}</code>
          </p>
          {action(
            UI_TEXT.makerStatusLabel,
            { v: MAKER_PROTOCOL_VERSION, type: 'makerStatus', machineId: machine.id },
            !isAllowed,
          )}
          {action(
            UI_TEXT.makerRemoveMachine,
            {
              v: MAKER_PROTOCOL_VERSION,
              type: 'makerRemoveMachine',
              registrationId: machine.registrationId,
              machineId: machine.id,
            },
            !admission.isTrusted || !admission.isInteractive,
          )}
          {state.statuses.has(machine.id) && (
            <MachineStatus status={state.statuses.get(machine.id)} />
          )}
        </section>
      ))}
      {admission?.ports.map((target) => (
        <SerialControls key={target.port} target={target} allowed={isAllowed} send={send} />
      ))}
      <button
        type="button"
        disabled={admission?.isTrusted !== true || !admission.isInteractive}
        onClick={onAdd}
      >
        {UI_TEXT.makerAddMachine}
      </button>
      {state.presets !== undefined && (
        <section>
          <h3>{state.presets.title}</h3>
          {state.presets.notices.map((notice) => (
            <p key={notice}>{notice}</p>
          ))}
          {state.presets.presets.map((preset) => (
            <span key={preset.id}>
              {action(preset.type === 'command' ? preset.check.name : preset.name, {
                v: MAKER_PROTOCOL_VERSION,
                type: 'makerChoosePreset',
                presetId: preset.id,
              })}
            </span>
          ))}
        </section>
      )}
    </Modal>
  )
}

function MachineStatus({
  status,
}: {
  readonly status: Extract<MakerHostMessage, { type: 'makerStatus' }>['status'] | undefined
}) {
  if (status === undefined) return null
  return (
    <div>
      <p>
        {status.identity} · <code>{status.state}</code>
      </p>
      {!status.isHomed && <p>{UI_TEXT.makerNotHomed}</p>}
      {Object.keys(status.limits).length === 0 && <p>{UI_TEXT.makerLimitsUnavailable}</p>}
      {status.warnings.map((warning) => (
        <p role="note" key={warning}>
          {makerWarningText(warning)}
        </p>
      ))}
      <pre tabIndex={0}>
        {JSON.stringify(
          status,
          (_key, value: unknown) => (typeof value === 'number' ? formatNumber(value) : value),
          2,
        )}
      </pre>
    </div>
  )
}

function SerialControls({
  target,
  allowed,
  send,
}: {
  readonly target: Extract<MakerHostMessage, { type: 'makerState' }>['ports'][number]
  readonly allowed: boolean
  readonly send: (message: MakerSurfaceMessage) => boolean
}) {
  const [baud, setBaud] = useState(String(MAKER_SERIAL_DEFAULT_BAUD))
  const [duration, setDuration] = useState(String(MAKER_SERIAL_DEFAULT_DURATION_MS))
  const [hex, setHex] = useState('')
  const [dtr, setDtr] = useState(false)
  const [rts, setRts] = useState(false)
  const isValid =
    Number.isSafeInteger(Number(baud)) &&
    Number(baud) > 0 &&
    Number.isSafeInteger(Number(duration)) &&
    Number(duration) > 0 &&
    /^(?:[a-f0-9]{2})*$/.test(hex)
  const request = (operation: 'read' | 'write') => {
    send({
      v: MAKER_PROTOCOL_VERSION,
      type: 'makerSerial',
      id: crypto.randomUUID(),
      operation,
      target,
      baud: Number(baud),
      durationMs: Number(duration),
      dtr,
      rts,
      payloadHex: operation === 'read' ? '' : hex,
    })
  }
  return (
    <section>
      <h3>{target.port}</h3>
      <pre>{JSON.stringify(target, null, 2)}</pre>
      <p>{UI_TEXT.makerResetWarning}</p>
      {[
        { label: UI_TEXT.makerBaud, value: baud, update: setBaud },
        { label: UI_TEXT.makerDuration, value: duration, update: setDuration },
      ].map((field) => (
        <label key={field.label}>
          {field.label}
          <input
            type="number"
            min={1}
            step={1}
            value={field.value}
            onChange={(event) => {
              field.update(event.target.value)
            }}
          />
        </label>
      ))}
      {[
        { label: 'DTR', value: dtr, update: setDtr },
        { label: 'RTS', value: rts, update: setRts },
      ].map((field) => (
        <label key={field.label}>
          <input
            type="checkbox"
            checked={field.value}
            onChange={(event) => {
              field.update(event.target.checked)
            }}
          />
          {field.label}
        </label>
      ))}
      <label>
        {UI_TEXT.makerPayloadHex}
        <textarea
          value={hex}
          onChange={(event) => {
            setHex(event.target.value)
          }}
        />
      </label>
      <div className="maker-actions">
        <button
          type="button"
          disabled={!allowed || !isValid}
          onClick={() => {
            request('read')
          }}
        >
          {UI_TEXT.makerReadSerial}
        </button>
        <button
          type="button"
          disabled={!allowed || !isValid || hex === ''}
          onClick={() => {
            request('write')
          }}
        >
          {UI_TEXT.makerWriteSerial}
        </button>
      </div>
    </section>
  )
}
