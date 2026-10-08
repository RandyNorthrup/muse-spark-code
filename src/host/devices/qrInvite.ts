// Lane D: the QR invite is the identical text invite, rendered as modules.
// The QR payload is the canonical public invitation text byte for byte, so a
// scan decodes to the same string `importInvitation` already accepts. This
// module never sees a private key: encoding takes a parsed public invitation,
// decoding refuses private-key material before parsing.
import qrcode from 'qrcode-generator'
import { deviceInvitationSchema, type DeviceInvitation } from '../../shared/devices'
import { DevicePairingError, parseDeviceInvitationText } from '../../core/devices/pairing'

// Fixed QR framing words, not tunables: automatic version, medium error
// correction, raw bytes. Scanners append a trailing newline; only surrounding
// ASCII whitespace is trimmed, never inner content.
const QR_AUTO_VERSION = 0
const QR_ERROR_CORRECTION = 'M'
const QR_BYTE_MODE = 'Byte'
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
 * A scanned QR payload decodes to the identical text invite: surrounding
 * scanner whitespace is trimmed, then the strict text parser runs, so the
 * returned invitation stringifies back to the exact scanned bytes.
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

export interface QrInviteGrid {
  readonly size: number
  isDark(row: number, column: number): boolean
}

/**
 * QR modules for validated public text. Throws `invalid-frame` when the text
 * is not a canonical public invite or exceeds a single QR code's capacity,
 * instead of emitting a denser code or a second frame.
 */
export function qrInviteModules(publicText: string, now: number): QrInviteGrid {
  const text = encodeQrInviteText(decodeScannedInviteText(publicText, now), now)
  try {
    const code = qrcode(QR_AUTO_VERSION, QR_ERROR_CORRECTION)
    code.addData(text, QR_BYTE_MODE)
    code.make()
    // The encoder picks the smallest version that fits; a payload past the
    // format's maximum version throws inside make() and maps below to the
    // fixed word instead of emitting a code no scanner reads.
    const size = code.getModuleCount()
    return {
      size,
      isDark(row: number, column: number): boolean {
        if (
          !Number.isSafeInteger(row) ||
          !Number.isSafeInteger(column) ||
          row < 0 ||
          column < 0 ||
          row >= size ||
          column >= size
        )
          throw new DevicePairingError('invalid-frame')
        return code.isDark(row, column)
      },
    }
  } catch (error) {
    if (error instanceof DevicePairingError) throw error
    throw new DevicePairingError('invalid-frame')
  }
}
