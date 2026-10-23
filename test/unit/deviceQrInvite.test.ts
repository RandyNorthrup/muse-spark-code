// Lane D: a QR invite decodes to the identical text invite.
import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { DevicePairing } from '../../src/host/devices/devicePairing'
import {
  confirmDeviceFingerprint,
  createDeviceInvitation,
  DevicePairingError,
} from '../../src/core/devices/pairing'
import { decodeScannedInviteText, encodeQrInviteText } from '../../src/host/devices/qrInvite'
import { deviceTestExpiry, deviceTestNow } from './helpers/deviceFixtures'

const endpoint = { address: '127.0.0.1', port: 34_567 }
function invite(deviceId: string) {
  return createDeviceInvitation(endpoint, deviceId, deviceTestNow, deviceTestExpiry).invitation
}

describe('QR invite identity', () => {
  it('encodes the identical canonical text the manual path accepts', () => {
    const invitation = invite('a'.repeat(32))
    const text = encodeQrInviteText(invitation, deviceTestNow)
    expect(text).toBe(DevicePairing.publicText(invitation))
    const decoded = decodeScannedInviteText(text, deviceTestNow)
    expect(decoded).toEqual(invitation)
    expect(JSON.stringify(decoded)).toBe(text)
  })
  it('tolerates only surrounding scanner whitespace', () => {
    const text = encodeQrInviteText(invite('b'.repeat(32)), deviceTestNow)
    expect(JSON.stringify(decodeScannedInviteText(`\n${text}\n`, deviceTestNow))).toBe(text)
  })
  it('refuses tampered, expired, oversized, non-string and private-key text', () => {
    const text = encodeQrInviteText(invite('c'.repeat(32)), deviceTestNow)
    // A byte flip inside a hex field stays well-formed (a different id), so
    // tampering here breaks structure, truncates, or appends instead.
    for (const tampered of [text.replace('{', '['), text.slice(0, -10), `${text}x`]) {
      expect(tampered).not.toBe(text)
      expect(() => decodeScannedInviteText(tampered, deviceTestNow)).toThrow(DevicePairingError)
    }
    expect(() => decodeScannedInviteText(text, deviceTestExpiry + 1)).toThrow(DevicePairingError)
    expect(() =>
      decodeScannedInviteText('x'.repeat(DEVICE_LIMITS.invitationTextChars + 1), deviceTestNow),
    ).toThrow(DevicePairingError)
    expect(() => decodeScannedInviteText(undefined, deviceTestNow)).toThrow(DevicePairingError)
    expect(() => decodeScannedInviteText('', deviceTestNow)).toThrow(DevicePairingError)
    expect(() =>
      decodeScannedInviteText('-----BEGIN PRIVATE KEY-----\nabc', deviceTestNow),
    ).toThrow(DevicePairingError)
    expect(() => decodeScannedInviteText('{"privateKey":"abc"}', deviceTestNow)).toThrow(
      DevicePairingError,
    )
  })
  it('keeps private-key material out of every renderable text', () => {
    const invitation = invite('d'.repeat(32))
    const text = encodeQrInviteText(invitation, deviceTestNow)
    expect(text).not.toContain('PRIVATE KEY')
    expect(text).not.toContain('privateKey')
    // Pixels are lane U's lazy views; the host contract ends at this text.
    expect(JSON.stringify(decodeScannedInviteText(text, deviceTestNow))).toBe(text)
  })
})

describe('public copy without the private key cannot pair', () => {
  it('refuses confirmation signed with any other key', () => {
    const local = createDeviceInvitation(endpoint, 'e'.repeat(32), deviceTestNow, deviceTestExpiry)
    const peer = createDeviceInvitation(endpoint, 'f'.repeat(32), deviceTestNow, deviceTestExpiry)
    // Positive control: the true local key confirms the public peer invite.
    expect(() =>
      confirmDeviceFingerprint(
        local.invitation,
        peer.invitation,
        local.privateKeyPem,
        peer.invitation.fingerprint,
        deviceTestNow,
      ),
    ).not.toThrow()
    // The drill: only the copied public text, paired with a fresh key.
    const stranger = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const attackerPem = stranger.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const copied = decodeScannedInviteText(
      encodeQrInviteText(local.invitation, deviceTestNow),
      deviceTestNow,
    )
    expect(() =>
      confirmDeviceFingerprint(
        copied,
        peer.invitation,
        attackerPem,
        peer.invitation.fingerprint,
        deviceTestNow,
      ),
    ).toThrow(expect.objectContaining({ reason: 'storage' }))
  })
})
