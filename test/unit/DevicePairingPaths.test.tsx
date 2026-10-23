// @vitest-environment jsdom
// Both invitation paths carry the identical text: the QR figure renders the
// canonical public text beside its selectable manual copy, and pasted or
// typed text enters through the same string the scanner decodes.
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDeviceInvitation } from '../../src/core/devices/pairing'
import { decodeScannedInviteText, encodeQrInviteText } from '../../src/host/devices/qrInvite'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import {
  deviceHostMessageSchema,
  type DeviceActionResult,
  type DeviceHostMessage,
} from '../../src/shared/devicesPanel'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import {
  DevicePairing,
  type DeviceAction,
} from '../../src/webview/models/sections/agents/DevicePairing'
import QrFigure from '../../src/webview/models/sections/devices/qr/QrFigure'
import { qrGeneratorEncoder } from '../../src/webview/models/sections/devices/qr/qrGeneratorEncoder'

beforeEach(() => {
  setUiText(EN, 'en')
})
afterEach(() => {
  setUiText(EN, 'en')
})

const NOW = Date.now()
const EXPIRES_AT = NOW + 24 * 3600 * 1000
const invitation = createDeviceInvitation(
  { address: '127.0.0.1', port: 8443 },
  'd'.repeat(32),
  NOW,
  EXPIRES_AT,
).invitation

function pairReply(): DeviceHostMessage {
  return deviceHostMessageSchema.parse({
    type: 'deviceState',
    revision: 1,
    state: { enabled: true, discoveryEnabled: false, devices: [] },
    setup: { viewId: 'a'.repeat(32), requestId: 'b'.repeat(32), invitation },
  })
}

function renderPairing(sent: DeviceAction[]) {
  const send = (action: DeviceAction): Promise<DeviceActionResult> => {
    sent.push(action)
    return action.kind === 'pair'
      ? Promise.resolve({ ok: true, message: pairReply() })
      : Promise.resolve({ ok: false, reason: 'stale' })
  }
  render(
    <DevicePairing
      setup={undefined}
      busy={false}
      send={send}
      renderQr={(publicText: string) => <QrFigure text={publicText} encode={qrGeneratorEncoder} />}
    />,
  )
}

describe('M100 invitation paths', () => {
  it('shows the QR figure beside the identical manual text', async () => {
    const sent: DeviceAction[] = []
    renderPairing(sent)
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    const figure = await screen.findByRole('img', { name: EN.devices.qrCodeName })
    expect(figure.querySelectorAll('rect').length).toBeGreaterThan(1)
    const shown = screen.getByLabelText(EN.devices.copyInvitation)
    if (!(shown instanceof HTMLTextAreaElement)) throw new TypeError('missing invitation text')
    expect(decodeScannedInviteText(shown.value, NOW)).toEqual(invitation)
    expect(sent).toEqual([{ kind: 'pair' } satisfies DeviceAction])
  })

  it('enters typed text through the same string the scanner decodes', () => {
    const sent: DeviceAction[] = []
    renderPairing(sent)
    const typed = encodeQrInviteText(invitation, NOW)
    const field = screen.getByLabelText(EN.devices.scan)
    if (!(field instanceof HTMLTextAreaElement)) throw new TypeError('missing scan field')
    expect(Number(field.getAttribute('maxlength'))).toBe(DEVICE_LIMITS.invitationTextChars)
    expect(typed.length).toBeLessThan(DEVICE_LIMITS.invitationTextChars)
    fireEvent.change(field, { target: { value: typed } })
    const form = field.closest('form')
    if (form === null) throw new Error('missing import form')
    fireEvent.submit(form)
    expect(sent).toEqual([
      { kind: 'importInvitation', text: typed } satisfies Extract<
        DeviceAction,
        { kind: 'importInvitation' }
      >,
    ])
    expect(decodeScannedInviteText(typed, NOW)).toEqual(invitation)
  })
})
