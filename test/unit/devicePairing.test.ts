import { createPrivateKey, createPublicKey, sign, X509Certificate } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  createDeviceInvitation,
  parseDeviceInvitationText,
  confirmDeviceFingerprint,
  validateDevicePair,
  validateDeviceCertificate,
  devicePrivateKey,
} from '../../src/core/devices/pairing'
import { DEVICE_LIMITS } from '../../src/shared/constants'

const now = Date.UTC(2026, 9, 6)
function candidate(deviceId: string, port = 34_567) {
  return createDeviceInvitation(
    { address: '127.0.0.1', port },
    deviceId.repeat(32),
    now,
    now + 86_400_000,
  )
}
function paired() {
  const a = candidate('a')
  const b = candidate('b', 34_568)
  const pair = {
    local: a.invitation,
    peer: b.invitation,
    localConfirmation: confirmDeviceFingerprint(
      a.invitation,
      b.invitation,
      a.privateKeyPem,
      b.invitation.fingerprint,
      now,
    ),
    peerConfirmation: confirmDeviceFingerprint(
      b.invitation,
      a.invitation,
      b.privateKeyPem,
      a.invitation.fingerprint,
      now,
    ),
  }
  return { a, b, pair }
}

describe('offline device pairing', () => {
  it('generates an exact self-signed P-256 identity with a matching local key and no private invitation fields', () => {
    const a = candidate('a')
    const cert = validateDeviceCertificate(a.invitation, now)
    expect(cert.ca).toBe(true)
    expect(cert.subject).toBe('CN=muse-device-pair')
    expect(cert.checkPrivateKey(createPrivateKey(a.privateKeyPem))).toBe(true)
    expect(cert.verify(createPublicKey(a.privateKeyPem))).toBe(true)
    expect(JSON.stringify(a.invitation)).not.toContain('PRIVATE KEY')
    expect(parseDeviceInvitationText(JSON.stringify(a.invitation), now)).toEqual(a.invitation)
    expect(a.invitation.certificateDerBase64.length).toBeLessThan(
      DEVICE_LIMITS.certificateBase64Chars,
    )
  })

  it('requires both signatures and derives the same pair id on both screens after invitations expire', () => {
    const { pair } = paired()
    expect(validateDevicePair(pair, now, true)).toBe(pair.localConfirmation.pairId)
    expect(
      validateDevicePair(
        {
          local: pair.peer,
          peer: pair.local,
          localConfirmation: pair.peerConfirmation,
          peerConfirmation: pair.localConfirmation,
        },
        now,
      ),
    ).toBe(pair.localConfirmation.pairId)
    expect(validateDevicePair(pair, now + DEVICE_LIMITS.invitationValidityMs)).toBe(
      pair.localConfirmation.pairId,
    )
    expect(() => validateDevicePair(pair, now + DEVICE_LIMITS.invitationValidityMs, true)).toThrow(
      'invalid-frame',
    )
  })

  it('rejects wrong, swapped or unconfirmed fingerprints and copied invitations without the private key', () => {
    const { a, b, pair } = paired()
    expect(() =>
      confirmDeviceFingerprint(
        a.invitation,
        b.invitation,
        a.privateKeyPem,
        a.invitation.fingerprint,
        now,
      ),
    ).toThrow('invalid-frame')
    expect(() =>
      confirmDeviceFingerprint(
        a.invitation,
        b.invitation,
        b.privateKeyPem,
        b.invitation.fingerprint,
        now,
      ),
    ).toThrow('storage')
    expect(() => devicePrivateKey(a.invitation, 'corrupt', now)).toThrow('storage')
    expect(() =>
      validateDevicePair({ ...pair, peerConfirmation: pair.localConfirmation }, now),
    ).toThrow('invalid-frame')
    expect(() =>
      validateDevicePair(
        {
          ...pair,
          localConfirmation: {
            ...pair.localConfirmation,
            signatureBase64: pair.peerConfirmation.signatureBase64,
          },
        },
        now,
      ),
    ).toThrow('invalid-frame')
  })

  it('binds endpoints, times, invitations, identities and confirmation time to both possession proofs', () => {
    const { a, pair } = paired()
    const mutations = [
      { ...pair.peer, endpoint: { ...pair.peer.endpoint, port: 34_569 } },
      { ...pair.peer, issuedAt: pair.peer.issuedAt + 1 },
      { ...pair.peer, invitationId: 'c'.repeat(32) },
      { ...pair.peer, fingerprint: a.invitation.fingerprint },
      { ...pair.peer, deviceId: pair.local.deviceId },
      pair.local,
    ]
    for (const peer of mutations) expect(() => validateDevicePair({ ...pair, peer }, now)).toThrow()
    expect(() =>
      validateDevicePair(
        { ...pair, peerConfirmation: { ...pair.peerConfirmation, confirmedAt: now + 1 } },
        now,
      ),
    ).toThrow('invalid-frame')
    expect(() =>
      validateDevicePair(
        {
          ...pair,
          peerConfirmation: {
            ...pair.peerConfirmation,
            confirmedAt: now + DEVICE_LIMITS.invitationValidityMs,
          },
        },
        now,
      ),
    ).toThrow('invalid-frame')
  })

  it('rejects expired and future invitations, duplicate-key text and oversized public payloads', () => {
    const { a, b } = paired()
    expect(() =>
      parseDeviceInvitationText(
        JSON.stringify(a.invitation),
        now + DEVICE_LIMITS.invitationValidityMs,
      ),
    ).toThrow('invalid-frame')
    expect(() =>
      parseDeviceInvitationText(
        JSON.stringify({
          ...a.invitation,
          issuedAt: now + DEVICE_LIMITS.clockSkewMs + 1,
          expiresAt: now + DEVICE_LIMITS.invitationValidityMs,
        }),
        now,
      ),
    ).toThrow('invalid-frame')
    expect(() =>
      parseDeviceInvitationText(JSON.stringify(a.invitation).replace('{', '{"version":1,'), now),
    ).toThrow('invalid-frame')
    expect(() =>
      parseDeviceInvitationText(' '.repeat(DEVICE_LIMITS.invitationTextChars + 1), now),
    ).toThrow('invalid-frame')
    expect(() =>
      parseDeviceInvitationText(
        JSON.stringify({ ...a.invitation, privateKey: b.privateKeyPem }),
        now,
      ),
    ).toThrow('invalid-frame')
  })

  it('rejects changed pin, expired certificate, malformed DER and correctly signed alternate profiles', () => {
    const { a } = paired()
    expect(() =>
      validateDeviceCertificate({ ...a.invitation, fingerprint: '0'.repeat(64) }, now),
    ).toThrow('invalid-frame')
    expect(() => validateDeviceCertificate(a.invitation, now + 86_400_000)).toThrow('invalid-frame')
    const raw = Buffer.from(a.invitation.certificateDerBase64, 'base64')
    const cert = new X509Certificate(raw)
    expect(cert.subject).toBe('CN=muse-device-pair')
    // Re-sign the exact TBS after changing the fixed opaque subject, so signature
    // verification alone succeeds and only the profile guard catches it.
    const outerHeader = 4
    const tbsSize = raw.readUInt16BE(outerHeader + 2) + 4
    const body = Buffer.from(raw.subarray(outerHeader, outerHeader + tbsSize))
    const subject = body.indexOf('muse-device-pair')
    expect(subject).toBeGreaterThan(0)
    body[subject] = 'x'.codePointAt(0)!
    const signature = sign('sha256', body, createPrivateKey(a.privateKeyPem))
    const bitString = Buffer.concat([Buffer.from([3, signature.length + 1, 0]), signature])
    const payload = Buffer.concat([body, Buffer.from('300a06082a8648ce3d040302', 'hex'), bitString])
    const alternate = Buffer.concat([
      Buffer.from([0x30, 0x82, payload.length >> 8, payload.length & 0xff]),
      payload,
    ])
    const alternateCert = new X509Certificate(alternate)
    expect(alternateCert.verify(alternateCert.publicKey)).toBe(true)
    expect(() =>
      validateDeviceCertificate(
        {
          ...a.invitation,
          certificateDerBase64: alternate.toString('base64'),
          fingerprint: alternateCert.fingerprint256.replaceAll(':', '').toLowerCase(),
        },
        now,
      ),
    ).toThrow('invalid-frame')
    expect(() =>
      validateDeviceCertificate({ ...a.invitation, certificateDerBase64: 'AAAA' }, now),
    ).toThrow('invalid-frame')
  })
})

it('bounds public input before JSON parsing', () => {
  const parser = vi.spyOn(JSON, 'parse')
  try {
    expect(() =>
      parseDeviceInvitationText(' '.repeat(DEVICE_LIMITS.invitationTextChars + 1), now),
    ).toThrow('invalid-frame')
    expect(parser).not.toHaveBeenCalled()
  } finally {
    parser.mockRestore()
  }
})
it('refuses reflected identities before signing', () => {
  const a = candidate('a')
  expect(() =>
    confirmDeviceFingerprint(
      a.invitation,
      a.invitation,
      a.privateKeyPem,
      a.invitation.fingerprint,
      now,
    ),
  ).toThrow('invalid-frame')
})
