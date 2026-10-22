// Lane D: the QR invite is the identical text invite. The QR payload is the
// canonical public invitation text byte for byte, so a scan decodes to the
// same string `importInvitation` already accepts. This module never sees a
// private key: encoding takes a parsed public invitation, decoding refuses
// private-key material before parsing. Pixels are lane U's lazy qr/ views:
// the host bundle's budget cannot carry a render encoder, so the installed
// encoder dependency is consumed there, never here.
import { deviceInvitationSchema, type DeviceInvitation } from '../../shared/devices'
import { DevicePairingError, parseDeviceInvitationText } from '../../core/devices/pairing'

// Scanners append a trailing newline; only surrounding ASCII whitespace is
// trimmed, never inner content.
const PRIVATE_KEY_SENTINEL = 'PRIVATE KEY'
const PRIVATE_KEY_FIELD = '"privateKey"'

function rejectPrivateMaterial(text: string): void {
  if (text.includes(PRIVATE_KEY_SENTINEL) || text.includes(PRIVATE_KEY_FIELD))
    throw new DevicePairingError('invalid-frame')
}

/** Canonical public text for the invitation, safe to render into a QR code. */
export function encodeQrInviteText(invitation: DeviceInvitation, now: number): string {
  try {
    const parsed = deviceInvitationSchema.parse(invitation)
    const text = JSON.stringify(parsed)
    parseDeviceInvitationText(text, now)
    return text
  } catch (error) {
    if (error instanceof DevicePairingError) throw error
    throw new DevicePairingError('invalid-frame')
  }
}

/**
A scanned QR payload decodes to the identical text invite: surrounding
scanner whitespace is trimmed, then the strict text parser runs, so the
returned invitation stringifies back to the exact scanned bytes.
*/
export function decodeScannedInviteText(scanned: unknown, now: number): DeviceInvitation {
  try {
    if (typeof scanned !== 'string') throw new DevicePairingError('invalid-frame')
    const text = scanned.trim()
    if (text.length === 0) throw new DevicePairingError('invalid-frame')
    rejectPrivateMaterial(text)
    return parseDeviceInvitationText(text, now)
  } catch (error) {
    if (error instanceof DevicePairingError) throw error
    throw new DevicePairingError('invalid-frame')
  }
}
