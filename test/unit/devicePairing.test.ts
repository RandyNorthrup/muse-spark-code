import {
  createPrivateKey,
  generateKeyPairSync,
  createPublicKey,
  sign,
  X509Certificate,
} from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createServer, connect, type TLSSocket } from 'node:tls'
import type { DevicePairingConfirmation } from '../../src/shared/devices'
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

it('rejects self-signature corruption even when the copied public pin matches the corrupt bytes', () => {
  const { a } = paired()
  const bytes = Buffer.from(a.invitation.certificateDerBase64, 'base64')
  bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 1
  const certificate = new X509Certificate(bytes)
  expect(certificate.verify(certificate.publicKey)).toBe(false)
  expect(() =>
    validateDeviceCertificate(
      {
        ...a.invitation,
        certificateDerBase64: bytes.toString('base64'),
        fingerprint: certificate.fingerprint256.replaceAll(':', '').toLowerCase(),
      },
      now,
    ),
  ).toThrow('invalid-frame')
})

function signedConfirmation(
  proof: DevicePairingConfirmation,
  pem: string,
): DevicePairingConfirmation {
  const text = JSON.stringify([
    'muse-device-confirm-v1',
    proof.version,
    proof.pairId,
    proof.localInvitationId,
    proof.peerInvitationId,
    proof.localFingerprint,
    proof.peerFingerprint,
    proof.transcriptDigest,
    proof.confirmedAt,
  ])
  return {
    ...proof,
    signatureBase64: sign('sha256', Buffer.from(text), createPrivateKey(pem)).toString('base64'),
  }
}
it.each([
  'pairId',
  'localInvitationId',
  'peerInvitationId',
  'localFingerprint',
  'peerFingerprint',
  'transcriptDigest',
] as const)('rejects a valid peer signature over the wrong %s', (field) => {
  const { b, pair } = paired()
  const proof = {
    ...pair.peerConfirmation,
    [field]: '0'.repeat(pair.peerConfirmation[field].length),
  }
  expect(() =>
    validateDevicePair(
      { ...pair, peerConfirmation: signedConfirmation(proof, b.privateKeyPem) },
      now,
    ),
  ).toThrow('invalid-frame')
})
it('rejects a correctly signed future confirmation and retains strict reflection checks', () => {
  const { b, pair } = paired()
  const proof = signedConfirmation(
    { ...pair.peerConfirmation, confirmedAt: now + DEVICE_LIMITS.clockSkewMs + 1 },
    b.privateKeyPem,
  )
  expect(() => validateDevicePair({ ...pair, peerConfirmation: proof }, now)).toThrow(
    'invalid-frame',
  )
})

it('uses the generated production profile in a real mutually verified TLS 1.3 exchange', async () => {
  const actualNow = Date.now()
  const a = createDeviceInvitation(
    { address: '127.0.0.1', port: 34_567 },
    'a'.repeat(32),
    actualNow,
    actualNow + 86_400_000,
  )
  const b = createDeviceInvitation(
    { address: '127.0.0.1', port: 34_568 },
    'b'.repeat(32),
    actualNow,
    actualNow + 86_400_000,
  )
  const pem = (invitation: typeof a.invitation) =>
    new X509Certificate(Buffer.from(invitation.certificateDerBase64, 'base64')).toString()
  const sockets = new Set<TLSSocket>()
  let didAuthenticate = false
  const server = createServer(
    {
      key: b.privateKeyPem,
      cert: pem(b.invitation),
      ca: [pem(a.invitation)],
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
      maxVersion: 'TLSv1.3',
    },
    (socket) => {
      sockets.add(socket)
      didAuthenticate =
        socket.authorized &&
        new X509Certificate(socket.getPeerCertificate().raw).fingerprint256
          .replaceAll(':', '')
          .toLowerCase() === a.invitation.fingerprint
      socket.end('profile-accepted')
    },
  )
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('No test listener')
    const response = await new Promise<string>((resolve, reject) => {
      const socket = connect({
        host: '127.0.0.1',
        port: address.port,
        key: a.privateKeyPem,
        cert: pem(a.invitation),
        ca: [pem(b.invitation)],
        rejectUnauthorized: true,
        minVersion: 'TLSv1.3',
        maxVersion: 'TLSv1.3',
        checkServerIdentity: (_host, certificate) =>
          new X509Certificate(certificate.raw).fingerprint256.replaceAll(':', '').toLowerCase() ===
          b.invitation.fingerprint
            ? undefined
            : new Error('Test pin mismatch'),
      })
      sockets.add(socket)
      let result = ''
      socket.on('data', (data: Buffer) => {
        result += data.toString()
      })
      socket.once('end', () => {
        resolve(result)
      })
      socket.once('error', reject)
      socket.setTimeout(10_000, () => {
        socket.destroy()
        reject(new Error('Test TLS timeout'))
      })
    })
    expect(response).toBe('profile-accepted')
    expect(didAuthenticate).toBe(true)
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve()
      }),
    )
  }
})

function testDer(tag: number, body: Buffer): Buffer {
  const size = body.length
  let length = Buffer.from([size])
  if (size >= 256) length = Buffer.from([0x82, size >> 8, size & 0xff])
  else if (size >= 128) length = Buffer.from([0x81, size])
  return Buffer.concat([Buffer.from([tag]), length, body])
}
function alteredCertificate(
  a: ReturnType<typeof candidate>,
  replacement: { from: Buffer; to: Buffer },
  key = createPrivateKey(a.privateKeyPem),
) {
  const original = Buffer.from(a.invitation.certificateDerBase64, 'base64')
  const bodySize = original.readUInt16BE(6)
  const body = original.subarray(8, 8 + bodySize)
  const at = body.indexOf(replacement.from)
  if (at === -1) throw new Error('Missing public profile segment')
  const tbs = testDer(
    0x30,
    Buffer.concat([
      body.subarray(0, at),
      replacement.to,
      body.subarray(at + replacement.from.length),
    ]),
  )
  const certificate = testDer(
    0x30,
    Buffer.concat([
      tbs,
      Buffer.from('300a06082a8648ce3d040302', 'hex'),
      testDer(3, Buffer.concat([Buffer.from([0]), sign('sha256', tbs, key)])),
    ]),
  )
  const parsed = new X509Certificate(certificate)
  expect(parsed.verify(parsed.publicKey)).toBe(true)
  return {
    ...a.invitation,
    certificateDerBase64: certificate.toString('base64'),
    fingerprint: parsed.fingerprint256.replaceAll(':', '').toLowerCase(),
  }
}
it('refuses a correctly signed alternate EC curve in the same fixed profile', () => {
  const a = candidate('a')
  const keys = generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
  const originalKey = new X509Certificate(Buffer.from(a.invitation.certificateDerBase64, 'base64'))
    .publicKey
  const alternate = alteredCertificate(
    a,
    {
      from: originalKey.export({ type: 'spki', format: 'der' }),
      to: keys.publicKey.export({ type: 'spki', format: 'der' }),
    },
    keys.privateKey,
  )
  expect(() => validateDeviceCertificate(alternate, now)).toThrow('invalid-frame')
})
it('refuses a correctly signed alternate serial profile', () => {
  const a = candidate('a')
  const serial = new X509Certificate(Buffer.from(a.invitation.certificateDerBase64, 'base64'))
    .serialNumber
  const alternate = alteredCertificate(a, {
    from: Buffer.concat([Buffer.from([2, 17, 0]), Buffer.from(serial, 'hex')]),
    to: Buffer.from([2, 1, 1]),
  })
  expect(() => validateDeviceCertificate(alternate, now)).toThrow('invalid-frame')
})

it.each(['invitation', 'device', 'fingerprint'])(
  'rejects single-field %s reflection before issuing a signature',
  (field) => {
    const a = candidate('a')
    const b = candidate('b')
    let peer = b.invitation
    if (field === 'invitation') peer = { ...peer, invitationId: a.invitation.invitationId }
    else if (field === 'device') peer = { ...peer, deviceId: a.invitation.deviceId }
    else
      peer = {
        ...a.invitation,
        invitationId: b.invitation.invitationId,
        deviceId: b.invitation.deviceId,
      }
    expect(() =>
      confirmDeviceFingerprint(a.invitation, peer, a.privateKeyPem, peer.fingerprint, now),
    ).toThrow('invalid-frame')
  },
)
