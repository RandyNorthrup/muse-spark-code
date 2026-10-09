import { type ReactNode, useContext, useEffect, useId, useRef, useState } from 'react'
import { DEVICE_LIMITS, UI_TEXT } from '../../../../shared/constants'
import { devicePairingConfirmationSchema, type DeviceInvitation } from '../../../../shared/devices'
import {
  type DeviceActionResult,
  type DeviceHostMessage,
  type DeviceWebviewRequest,
} from '../../../../shared/devicesPanel'
import { DeviceFingerprint } from './DeviceFingerprint'
import { DeviceDraftContext } from './deviceDraft'

export type DeviceAction = DeviceWebviewRequest['action']

export function DevicePairing({
  setup,
  busy,
  send,
  renderQr,
}: {
  readonly setup: DeviceHostMessage['setup']
  readonly busy: boolean
  readonly send: (action: DeviceAction) => Promise<DeviceActionResult>
  /** Qualified local QR encoder supplied by P/I; the text path is always present. */
  readonly renderQr?: ((publicText: string) => ReactNode) | undefined
}) {
  const [local, setLocal] = useState<DeviceInvitation>()
  const [peer, setPeer] = useState<DeviceInvitation>()
  // The unsent peer-invitation draft survives a document reload (lane W).
  const draft = useContext(DeviceDraftContext)
  const [text, setText] = useState(draft?.initial ?? '')
  const [isCompared, setCompared] = useState(false)
  const [error, setError] = useState(false)
  const invitationInputId = useId()
  const peerHeading = useRef<HTMLHeadingElement>(null)
  const importButton = useRef<HTMLButtonElement>(null)
  const request = (action: DeviceAction) => {
    setError(false)
    void send(action).then((result) => {
      if (!result.ok || result.message.setup?.failure !== undefined) return
      const response = result.message
      if (action.kind === 'pair' && response.setup?.invitation !== undefined) {
        setLocal(response.setup.invitation)
        setPeer(undefined)
        setCompared(false)
      }
      if (action.kind !== 'importInvitation' || response.setup?.invitation === undefined) {
        return
      }

      setPeer(response.setup.invitation)
      setCompared(false)
    })
  }
  useEffect(() => {
    peerHeading.current?.focus()
  }, [peer])
  const confirmation = setup?.failure === undefined ? setup?.confirmation : undefined
  const publicText = local === undefined ? undefined : JSON.stringify(local)
  return (
    <section className="device-pairing" aria-label={UI_TEXT.devices.pair}>
      <p>{UI_TEXT.devices.pairingHelp}</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          request({ kind: 'pair' })
        }}
      >
        {UI_TEXT.devices.pair}
      </button>
      {local !== undefined && publicText !== undefined && (
        <>
          <DeviceFingerprint label={UI_TEXT.devices.fingerprint} fingerprint={local.fingerprint} />
          <PublicText
            label={UI_TEXT.devices.copyInvitation}
            text={publicText}
            renderQr={renderQr}
          />
        </>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (text.trim().length === 0) return
          request({ kind: 'importInvitation', text })
        }}
      >
        <label htmlFor={invitationInputId}>{UI_TEXT.devices.scan}</label>
        <textarea
          id={invitationInputId}
          maxLength={DEVICE_LIMITS.invitationTextChars}
          value={text}
          onChange={(event) => {
            setText(event.currentTarget.value)
            draft?.save(event.currentTarget.value)
          }}
          required
        />
        <div className="device-decisions">
          <button ref={importButton} type="submit" disabled={busy || text.trim().length === 0}>
            {UI_TEXT.devices.importInvitation}
          </button>
          <button
            type="button"
            disabled={busy || text.trim().length === 0}
            onClick={() => {
              try {
                const raw: unknown = JSON.parse(text)
                const parsed = devicePairingConfirmationSchema.safeParse(raw)
                if (!parsed.success) {
                  setError(true)
                  return
                }
                request({ kind: 'importConfirmation', confirmation: parsed.data })
              } catch {
                setError(true)
              }
            }}
          >
            {UI_TEXT.devices.importConfirmation}
          </button>
        </div>
      </form>
      {peer !== undefined && (
        <div className="device-comparison">
          <DeviceFingerprint
            label={UI_TEXT.devices.peerFingerprint}
            fingerprint={peer.fingerprint}
            headingRef={peerHeading}
          />
          <p>{UI_TEXT.devices.compare}</p>
          <label>
            <input
              type="checkbox"
              checked={isCompared}
              onChange={(event) => {
                setCompared(event.currentTarget.checked)
              }}
            />
            {UI_TEXT.devices.fingerprintMatches}
          </label>
          <div className="device-decisions">
            <button
              type="button"
              disabled={busy || !isCompared}
              onClick={() => {
                if (!isCompared) return
                request({
                  kind: 'confirmFingerprint',
                  invitationId: peer.invitationId,
                  fingerprint: peer.fingerprint,
                })
              }}
            >
              {UI_TEXT.devices.confirmFingerprint}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPeer(undefined)
                setCompared(false)
                importButton.current?.focus()
              }}
            >
              {UI_TEXT.devices.cancel}
            </button>
          </div>
        </div>
      )}
      {confirmation !== undefined && (
        <PublicText
          label={UI_TEXT.devices.copyConfirmation}
          text={JSON.stringify(confirmation)}
          renderQr={renderQr}
        />
      )}
      {error && <p role="alert">{UI_TEXT.devices.invalidMessage}</p>}
    </section>
  )
}

function PublicText({
  label,
  text,
  renderQr,
}: {
  readonly label: string
  readonly text: string
  readonly renderQr: ((publicText: string) => ReactNode) | undefined
}) {
  const field = useRef<HTMLTextAreaElement>(null)
  const fieldId = useId()
  return (
    <div className="device-public-text">
      {renderQr?.(text)}
      <label htmlFor={fieldId}>{label}</label>
      <textarea
        id={fieldId}
        ref={field}
        readOnly
        value={text}
        onFocus={(event) => {
          event.currentTarget.select()
        }}
      />
      <button
        type="button"
        onClick={() => {
          field.current?.focus()
          field.current?.select()
          if ('clipboard' in navigator) {
            void navigator.clipboard.writeText(text).catch(() => {
              field.current?.select()
            })
          }
        }}
      >
        {label}
      </button>
    </div>
  )
}
