import { useId, useRef, useState } from 'react'
import { DEVICE_LIMITS, UI_TEXT } from '../../../../shared/constants'
import { deviceCapsSchema, deviceEndpointSchema, type DeviceCaps } from '../../../../shared/devices'
import { fill, formatBytes, formatNumber, plural } from '../../../../shared/l10n/text'
import { formatUsd } from '../../../../shared/l10n/exactUsd'
import type {
  DeviceActionResult,
  DeviceHostMessage,
  DevicesPanelState,
} from '../../../../shared/devicesPanel'
import type { DeviceThrottled } from '../../../../shared/devices'
import { webviewKey } from '../../../../shared/keybindings'
import type { DeviceAction } from './DevicePairing'
import { deviceObservationText, deviceStatusText } from './devicePresentation'
import { DeviceFingerprint } from './DeviceFingerprint'

type DeviceRow = Extract<DevicesPanelState, { enabled: true }>['devices'][number]

// M96/S supplies its saved board id and reconciled readiness. No invented board
// id, timeout, user assertion or connection observation enables Resume.
export interface DeviceBoardBinding {
  readonly pairId: string
  readonly boardId: string
  readonly canResume: boolean
}

export function DeviceCard({
  device,
  setup,
  throttled,
  isUnsupportedHost = false,
  boards,
  busy,
  send,
}: {
  readonly device: DeviceRow
  readonly setup: DeviceHostMessage['setup']
  readonly throttled?: DeviceThrottled | undefined
  readonly isUnsupportedHost?: boolean
  readonly boards: readonly DeviceBoardBinding[]
  readonly busy: boolean
  readonly send: (action: DeviceAction) => Promise<DeviceActionResult>
}) {
  const titleId = useId()
  const unlinkButton = useRef<HTMLButtonElement>(null)
  const [isUnlinking, setUnlinking] = useState(false)
  const act = (action: DeviceAction) => {
    void send(action)
  }
  const observation = throttled?.pairId === device.pairId ? throttled : undefined
  const canResume =
    device.unresolvedAttempts === 0 && (device.status === 'connected' || device.status === 'paused')
  return (
    <article className="device-card" aria-labelledby={titleId}>
      <h2 id={titleId}>{device.label}</h2>
      <p role="status">
        {observation === undefined ? deviceStatusText(device.status) : UI_TEXT.devices.throttled}
      </p>
      {observation !== undefined && (
        <p>
          {fill(UI_TEXT.devices.unknownSince, {
            time: deviceObservationText(observation.unknownSince),
          })}
        </p>
      )}
      {device.status === 'incompatible' && <p>{UI_TEXT.devices.protocolMismatch}</p>}
      <DeviceFingerprint label={UI_TEXT.devices.fingerprint} fingerprint={device.fingerprint} />
      {device.lastObservedAt !== undefined && (
        <p>
          {UI_TEXT.devices.lastObservation}: {deviceObservationText(device.lastObservedAt)}
        </p>
      )}
      {device.waitingApprovals > 0 && (
        <p role="status">{fill(UI_TEXT.devices.waitingApproval, { device: device.label })}</p>
      )}
      <p>{plural(UI_TEXT.devices.unresolvedCount, device.unresolvedAttempts)}</p>
      <p>
        {fill(UI_TEXT.devices.retainedLiability, {
          amount: formatUsd(device.retainedLiabilityUsd, 2),
        })}
      </p>
      <p>{UI_TEXT.devices.observationHelp}</p>
      {(device.status === 'offline' ||
        device.status === 'uncertain' ||
        device.status === 'paused' ||
        device.status === 'blocked-or-unreachable' ||
        device.unresolvedAttempts > 0) && <p>{UI_TEXT.devices.unresolvedHelp}</p>}
      {device.status === 'blocked-or-unreachable' && (
        <p>
          {fill(UI_TEXT.devices.blockedHelp, {
            application: setup?.listenerApplication ?? UI_TEXT.devices.unknown,
            interface: setup?.interfaceLabel ?? UI_TEXT.devices.unknown,
            address: device.endpoint.address,
            port: formatNumber(device.endpoint.port),
          })}
        </p>
      )}
      <p>{UI_TEXT.devices.localApprovalHelp}</p>
      <h3>{UI_TEXT.devices.rolesModels}</h3>
      {device.offers.length === 0 ? (
        <p>{UI_TEXT.devices.noOffers}</p>
      ) : (
        device.offers.map((offer) => (
          <div key={offer.poolId} className="device-offer">
            <p>
              <code>
                {offer.platform} · {offer.toolchainDigest}
              </code>
            </p>
            <CapSummary caps={offer.caps} />
            <ul>
              {offer.entries.map((entry) => (
                <li key={entry.entryId}>
                  <code>
                    {entry.roleId} · {entry.model.providerId}/{entry.model.modelId}
                  </code>
                  <p>
                    {UI_TEXT.devices.payer}: {UI_TEXT.devices.payers[entry.payer]} ·{' '}
                    {UI_TEXT.devices.readiness}: {UI_TEXT.devices.readinessStates[entry.readiness]}
                  </p>
                  <CapSummary caps={entry.caps} />
                </li>
              ))}
            </ul>
            {offer.checks && (
              <p>
                {UI_TEXT.devices.offerChecks}: {formatNumber(offer.checkIds.length)}
              </p>
            )}
          </div>
        ))
      )}
      <AddressEditor key={JSON.stringify(device.endpoint)} device={device} busy={busy} act={act} />
      <OfferEditor
        key={JSON.stringify(device.offers.map((offer) => offer.caps))}
        pairId={device.pairId}
        caps={device.offers[0]?.caps}
        busy={
          busy ||
          isUnsupportedHost ||
          setup?.failure === 'unsupported-host' ||
          device.status === 'incompatible'
        }
        act={act}
      />
      <div className="device-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            act({ kind: 'pauseOffers', pairId: device.pairId })
          }}
        >
          {UI_TEXT.devices.pause}
        </button>
        {boards
          .filter((board) => board.pairId === device.pairId)
          .map((board) => (
            <button
              key={board.boardId}
              type="button"
              disabled={busy || !canResume || !board.canResume}
              onClick={() => {
                if (!canResume || !board.canResume) return
                act({ kind: 'resumeQueue', pairId: device.pairId, boardId: board.boardId })
              }}
            >
              {UI_TEXT.devices.resume} ({board.boardId})
            </button>
          ))}
        <button
          ref={unlinkButton}
          type="button"
          disabled={busy}
          onClick={() => {
            setUnlinking(true)
          }}
        >
          {UI_TEXT.devices.unlink}
        </button>
      </div>
      {isUnlinking && (
        <fieldset
          className="device-unlink"
          onKeyDown={(event) => {
            if (webviewKey('devices.unlink', event) !== 'close') {
              return
            }

            setUnlinking(false)
            unlinkButton.current?.focus()
          }}
        >
          <legend>{UI_TEXT.devices.unlink}</legend>
          <p>{UI_TEXT.devices.unlinkHelp}</p>
          <div className="device-decisions">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                act({ kind: 'unlink', pairId: device.pairId })
              }}
            >
              {UI_TEXT.devices.confirmUnlink}
            </button>
            <button
              type="button"
              onClick={() => {
                setUnlinking(false)
                unlinkButton.current?.focus()
              }}
            >
              {UI_TEXT.devices.cancel}
            </button>
          </div>
        </fieldset>
      )}
    </article>
  )
}

function CapSummary({ caps }: { readonly caps: DeviceCaps }) {
  return (
    <dl className="device-facts">
      {Object.entries(caps).map(([key, value]) => {
        const label = capLabel(key)
        return (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{formatCap(key, value)}</dd>
          </div>
        )
      })}
    </dl>
  )
}

function capLabel(key: string): string {
  switch (key) {
    case 'spendUsd': {
      return UI_TEXT.devices.spend
    }
    case 'artifactBytes': {
      return UI_TEXT.devices.artifact
    }
    case 'workers':
    case 'processes':
    case 'heavyChecks':
    case 'tokens': {
      return UI_TEXT.devices[key]
    }
    default: {
      throw new Error('invalid-device-message')
    }
  }
}

function AddressEditor({
  device,
  busy,
  act,
}: {
  readonly device: DeviceRow
  readonly busy: boolean
  readonly act: (action: DeviceAction) => void
}) {
  const [isInvalid, setInvalid] = useState(false)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const parsed = deviceEndpointSchema.safeParse({
          address: form.get('address'),
          port: Number(form.get('port')),
        })
        setInvalid(!parsed.success)
        if (parsed.success)
          act({ kind: 'setAddress', pairId: device.pairId, endpoint: parsed.data })
      }}
    >
      <fieldset disabled={busy}>
        <legend>{UI_TEXT.devices.manualAddress}</legend>
        <label>
          {UI_TEXT.devices.address}
          <input
            name="address"
            defaultValue={device.endpoint.address}
            maxLength={DEVICE_LIMITS.addressChars}
            required
          />
        </label>
        <label>
          {UI_TEXT.devices.port}
          <input
            name="port"
            type="number"
            defaultValue={device.endpoint.port}
            min={1}
            max={DEVICE_LIMITS.portMax}
            step={1}
            required
          />
        </label>
        <button type="submit">{UI_TEXT.devices.retryAddress}</button>
        {isInvalid && <p role="alert">{UI_TEXT.devices.invalidMessage}</p>}
      </fieldset>
    </form>
  )
}

const CAP_KEYS = [
  'workers',
  'processes',
  'heavyChecks',
  'tokens',
  'spendUsd',
  'artifactBytes',
] as const
// The browser Devices closure reads DEVICE_LIMITS only through literal
// member access (the build's reader-only lazy module refuses element reads),
// so the per-cap maxima live in this literal table beside the key tuple.
const CAP_MAXIMA: Record<(typeof CAP_KEYS)[number], number> = {
  workers: DEVICE_LIMITS.workers,
  processes: DEVICE_LIMITS.processes,
  heavyChecks: DEVICE_LIMITS.heavyChecks,
  tokens: DEVICE_LIMITS.tokens,
  spendUsd: DEVICE_LIMITS.spendUsd,
  artifactBytes: DEVICE_LIMITS.artifactBytes,
}

function OfferEditor({
  pairId,
  caps,
  busy,
  act,
}: {
  readonly pairId: string
  readonly caps: DeviceCaps | undefined
  readonly busy: boolean
  readonly act: (action: DeviceAction) => void
}) {
  const [isInvalid, setInvalid] = useState(false)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const hasLanes = form.has('lanes')
        const hasChecks = form.has('checks')
        const parsed = deviceCapsSchema.safeParse(
          Object.fromEntries(CAP_KEYS.map((key) => [key, Number(form.get(key))])),
        )
        const isValid =
          (hasLanes || hasChecks) &&
          parsed.success &&
          parsed.data.processes > 0 &&
          (!hasLanes || parsed.data.workers > 0) &&
          (!hasChecks || parsed.data.heavyChecks > 0)
        setInvalid(!isValid)
        if (isValid)
          act({ kind: 'offer', pairId, lanes: hasLanes, checks: hasChecks, caps: parsed.data })
      }}
    >
      <fieldset disabled={busy}>
        <legend>{UI_TEXT.devices.offerScope}</legend>
        <p>{UI_TEXT.devices.scopeHelp}</p>
        <p>{UI_TEXT.devices.capHelp}</p>
        <label>
          <input type="checkbox" name="lanes" />
          {UI_TEXT.devices.offer}
        </label>
        <label>
          <input type="checkbox" name="checks" />
          {UI_TEXT.devices.offerChecks}
        </label>
        {CAP_KEYS.map((key) => (
          <label key={key}>
            {capLabel(key)}
            <input
              name={key}
              type="number"
              min={0}
              max={CAP_MAXIMA[key]}
              step={key === 'spendUsd' ? 'any' : 1}
              defaultValue={caps === undefined ? 0 : caps[key]}
              required
            />
          </label>
        ))}
        <button type="submit">{UI_TEXT.devices.saveOffer}</button>
        {isInvalid && <p role="alert">{UI_TEXT.devices.invalidMessage}</p>}
      </fieldset>
    </form>
  )
}

function formatCap(key: string, value: number): string {
  if (key === 'spendUsd') return formatUsd(value, 2)
  return key === 'artifactBytes' ? formatBytes(value) : formatNumber(value)
}
