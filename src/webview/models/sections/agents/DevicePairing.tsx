import { type ReactNode, useEffect, useRef, useState } from 'react'
import { DEVICE_LIMITS, UI_TEXT } from '../../../../shared/constants'
import { devicePairingConfirmationSchema, type DeviceInvitation } from '../../../../shared/devices'
import { type DeviceHostMessage, type DeviceWebviewRequest } from '../../../../shared/modelsPanel'

export type DeviceAction = DeviceWebviewRequest['action']

export function DevicePairing({
  setup,
  busy,
  send,
  renderQr,
}: {
  readonly setup: DeviceHostMessage['setup']
  readonly busy: boolean
  readonly send: (action: DeviceAction) => Promise<DeviceHostMessage | undefined>
  /** Qualified local QR encoder supplied by P/I; the text path is always present. */
  readonly renderQr?: ((publicText: string) => ReactNode) | undefined
}) {
  const [local, setLocal] = useState<DeviceInvitation>()
  const [peer, setPeer] = useState<DeviceInvitation>()
  const [text, setText] = useState('')
  const [isCompared, setCompared] = useState(false)
  const [error, setError] = useState(false)
  const peerHeading = useRef<HTMLHeadingElement>(null)
  const request = (action: DeviceAction) => {
    setError(false)
    void send(action).then((response) => {
      if (response?.setup?.failure !== undefined) return
      if (action.kind === 'pair' && response?.setup?.invitation !== undefined) {
        setLocal(response.setup.invitation)
        setPeer(undefined)
        setCompared(false)
      }
      if (action.kind !== 'importInvitation' || response?.setup?.invitation === undefined) {
        return
      }

      setPeer(response.setup.invitation)
      setCompared(false)
    })
  }
  useEffect(() => {
    peerHeading.current?.focus()
  }, [peer])
  const confirmation = setup?.confirmation
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
          <p>
            {UI_TEXT.devices.fingerprint}: <code>{local.fingerprint}</code>
          </p>
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
        <label>
          {UI_TEXT.devices.scan}
          <textarea
            maxLength={DEVICE_LIMITS.invitationTextChars}
            value={text}
            onChange={(event) => {
              setText(event.currentTarget.value)
            }}
            required
          />
        </label>
        <button type="submit" disabled={busy || text.trim().length === 0}>
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
      </form>
      {peer !== undefined && (
        <div className="device-comparison">
          <h3 ref={peerHeading} tabIndex={-1}>
            {UI_TEXT.devices.peerFingerprint}
          </h3>
          <code>{peer.fingerprint}</code>
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
  return (
    <div className="device-public-text">
      {renderQr?.(text)}
      <label>
        {label}
        <textarea
          ref={field}
          readOnly
          value={text}
          onFocus={(event) => {
            event.currentTarget.select()
          }}
        />
      </label>
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
