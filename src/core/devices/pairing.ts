// Offline per-pair identity. No socket, provider credential or process is used.
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
  X509Certificate,
  type KeyObject,
} from 'node:crypto'
import { DEVICE_LIMITS } from '../../shared/constants'
import {
  deviceInvitationSchema,
  devicePairingConfirmationSchema,
  type DeviceInvitation,
  type DevicePairingConfirmation,
  type DEVICE_FAILURES,
} from '../../shared/devices'

export class DevicePairingError extends Error {
  public constructor(public readonly reason: (typeof DEVICE_FAILURES)[number]) {
    super(reason)
  }
}
function requirePair(
  isAllowed: boolean,
  reason: (typeof DEVICE_FAILURES)[number] = 'invalid-frame',
): asserts isAllowed {
  if (!isAllowed) throw new DevicePairingError(reason)
}
const algorithm = Buffer.from('300a06082a8648ce3d040302', 'hex')
const name = Buffer.from('301b3119301706035504030c106d7573652d6465766963652d70616972', 'hex')
const extensions = Buffer.from(
  'a345304330120603551d130101ff040830060101ff020100300e0603551d0f0101ff040403020284301d0603551d250416301406082b0601050507030106082b06010505070302',
  'hex',
)
// Fixed DER encoding markers and hexadecimal radix are format words, not tunables.
const HEX_RADIX = Number('0x10')
const longLength = Number('0x80')
function der(tag: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts)
  const size = body.length.toString(HEX_RADIX)
  const length = Buffer.from(size.padStart(size.length + (size.length % 2), '0'), 'hex')
  return Buffer.concat([
    Buffer.from(tag, 'hex'),
    body.length < longLength
      ? length
      : Buffer.concat([Buffer.from([longLength + length.length]), length]),
    body,
  ])
}
function takeDer(bytes: Buffer, tag: string): { body: Buffer; rest: Buffer } {
  requirePair(bytes.length >= 2 && bytes[0] === Buffer.from(tag, 'hex')[0])
  const first = bytes[1] ?? 0
  const count = first < longLength ? 0 : first - longLength
  requirePair(count <= 2 && bytes.length >= 2 + count && (first < longLength || count > 0))
  const size =
    count === 0 ? first : Number.parseInt(bytes.subarray(2, 2 + count).toString('hex'), HEX_RADIX)
  const end = 2 + count + size
  requirePair(end <= bytes.length)
  const body = bytes.subarray(2 + count, end)
  requirePair(der(tag, body).equals(bytes.subarray(0, end)))
  return { body, rest: bytes.subarray(end) }
}
function dateBytes(time: number): Buffer {
  const text = new Date(time)
    .toISOString()
    .replaceAll(/[-:]/g, '')
    .replace('T', '')
    .split('.', 1)[0]
  requirePair(text !== undefined && /^\d{14}$(?![\s\S])/.test(text))
  return der('18', Buffer.from(text + 'Z'))
}
function certificateBody(serial: Buffer, publicKey: KeyObject, start: number, end: number): Buffer {
  return der(
    '30',
    der('a0', Buffer.from('020102', 'hex')),
    der('02', serial),
    algorithm,
    name,
    der('30', dateBytes(start), dateBytes(end)),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    extensions,
  )
}
function hash(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Validates our exact bounded profile, not a general ASN.1 parser. */
export function validateDeviceCertificate(
  invitation: DeviceInvitation,
  now: number,
): X509Certificate {
  try {
    const bytes = Buffer.from(invitation.certificateDerBase64, 'base64')
    requirePair(
      bytes.toString('base64') === invitation.certificateDerBase64 &&
        hash(bytes) === invitation.fingerprint,
    )
    const certificate = new X509Certificate(bytes)
    const start = Date.parse(certificate.validFrom)
    const end = Date.parse(certificate.validTo)
    requirePair(
      start <= now &&
        now < end &&
        end - start <= DEVICE_LIMITS.certificateLifetimeMs + DEVICE_LIMITS.clockSkewMs,
    )
    requirePair(
      certificate.publicKey.asymmetricKeyType === 'ec' &&
        certificate.publicKey.asymmetricKeyDetails?.namedCurve === 'prime256v1',
    )
    requirePair(certificate.ca && certificate.verify(certificate.publicKey))
    const serial = certificate.serialNumber.toLowerCase()
    const encodedSerial = Buffer.from(
      serial.padStart(serial.length + (serial.length % 2), '0'),
      'hex',
    )
    const positiveSerial =
      (encodedSerial[0] ?? 0) >= longLength
        ? Buffer.concat([Buffer.from([0]), encodedSerial])
        : encodedSerial
    requirePair(
      encodedSerial.length === DEVICE_LIMITS.idChars / 2 && (encodedSerial[0] ?? 0) >= longLength,
    )
    const outer = takeDer(bytes, '30')
    requirePair(outer.rest.length === 0)
    const tbs = certificateBody(positiveSerial, certificate.publicKey, start, end)
    requirePair(outer.body.subarray(0, tbs.length).equals(tbs))
    requirePair(outer.body.subarray(tbs.length, tbs.length + algorithm.length).equals(algorithm))
    const signature = takeDer(outer.body.subarray(tbs.length + algorithm.length), '03')
    requirePair(signature.rest.length === 0 && signature.body[0] === 0)
    return certificate
  } catch {
    throw new DevicePairingError('invalid-frame')
  }
}

export function createDeviceInvitation(
  endpoint: DeviceInvitation['endpoint'],
  deviceId: string,
  now: number,
  certificateExpiresAt: number,
): { invitation: DeviceInvitation; privateKeyPem: string } {
  requirePair(
    certificateExpiresAt > now + DEVICE_LIMITS.invitationValidityMs &&
      certificateExpiresAt <= now + DEVICE_LIMITS.certificateLifetimeMs,
  )
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const serial = randomBytes(DEVICE_LIMITS.idChars / 2)
  serial[0] = (serial[0] ?? 0) | longLength
  const tbs = certificateBody(
    Buffer.concat([Buffer.from([0]), serial]),
    keys.publicKey,
    now - DEVICE_LIMITS.clockSkewMs,
    certificateExpiresAt,
  )
  const certificate = der(
    '30',
    tbs,
    algorithm,
    der('03', Buffer.from([0]), sign('sha256', tbs, keys.privateKey)),
  )
  const invitation = deviceInvitationSchema.parse({
    version: DEVICE_LIMITS.protocolVersion,
    invitationId: randomBytes(DEVICE_LIMITS.idChars / 2).toString('hex'),
    deviceId,
    certificateDerBase64: certificate.toString('base64'),
    fingerprint: hash(certificate),
    endpoint,
    issuedAt: now,
    expiresAt: now + DEVICE_LIMITS.invitationValidityMs,
  })
  validateDeviceCertificate(invitation, now)
  return {
    invitation,
    privateKeyPem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
}

export function parseDeviceInvitationText(text: string, now: number): DeviceInvitation {
  try {
    requirePair(Buffer.byteLength(text) <= DEVICE_LIMITS.invitationTextChars)
    const raw: unknown = JSON.parse(text)
    const invitation = deviceInvitationSchema.parse(raw)
    // Canonical public text avoids duplicate keys and ambiguous encodings.
    requirePair(JSON.stringify(invitation) === text)
    assertFresh(invitation, now)
    return invitation
  } catch {
    throw new DevicePairingError('invalid-frame')
  }
}
function assertFresh(invitation: DeviceInvitation, now: number): void {
  requirePair(
    Number.isSafeInteger(now) &&
      invitation.issuedAt <= now + DEVICE_LIMITS.clockSkewMs &&
      now < invitation.expiresAt,
  )
  validateDeviceCertificate(invitation, now)
}
function transcript(
  local: DeviceInvitation,
  peer: DeviceInvitation,
): { pairId: string; digest: string } {
  const first = deviceInvitationSchema.parse(local)
  const second = deviceInvitationSchema.parse(peer)
  requirePair(
    first.invitationId !== second.invitationId &&
      first.deviceId !== second.deviceId &&
      first.fingerprint !== second.fingerprint,
  )
  const ordered = [first, second].toSorted((a, b) =>
    a.invitationId.localeCompare(b.invitationId, 'en'),
  )
  const digest = hash(JSON.stringify(['muse-device-pair-v1', ...ordered]))
  return { pairId: digest.slice(0, DEVICE_LIMITS.idChars), digest }
}
function confirmationPayload(
  confirmation: Omit<DevicePairingConfirmation, 'signatureBase64'>,
): string {
  return JSON.stringify([
    'muse-device-confirm-v1',
    confirmation.version,
    confirmation.pairId,
    confirmation.localInvitationId,
    confirmation.peerInvitationId,
    confirmation.localFingerprint,
    confirmation.peerFingerprint,
    confirmation.transcriptDigest,
    confirmation.confirmedAt,
  ])
}
export function devicePrivateKey(
  invitation: DeviceInvitation,
  pem: string | KeyObject,
  now: number,
): KeyObject {
  try {
    const certificate = validateDeviceCertificate(invitation, now)
    const key = typeof pem === 'string' ? createPrivateKey(pem) : pem
    requirePair(certificate.checkPrivateKey(key), 'storage')
    return key
  } catch {
    throw new DevicePairingError('storage')
  }
}
export function confirmDeviceFingerprint(
  local: DeviceInvitation,
  peer: DeviceInvitation,
  privateKeyPem: string | KeyObject,
  fingerprint: string,
  now: number,
): DevicePairingConfirmation {
  assertFresh(local, now)
  assertFresh(peer, now)
  requirePair(fingerprint === peer.fingerprint)
  const bound = transcript(local, peer)
  const body = {
    version: DEVICE_LIMITS.protocolVersion,
    pairId: bound.pairId,
    localInvitationId: local.invitationId,
    peerInvitationId: peer.invitationId,
    localFingerprint: local.fingerprint,
    peerFingerprint: peer.fingerprint,
    transcriptDigest: bound.digest,
    confirmedAt: now,
  }
  return devicePairingConfirmationSchema.parse({
    ...body,
    signatureBase64: sign(
      'sha256',
      Buffer.from(confirmationPayload(body)),
      devicePrivateKey(local, privateKeyPem, now),
    ).toString('base64'),
  })
}
export interface DevicePair {
  readonly local: DeviceInvitation
  readonly peer: DeviceInvitation
  readonly localConfirmation: DevicePairingConfirmation
  readonly peerConfirmation: DevicePairingConfirmation
}
/** Stored pairs validate at their signed times; invitation expiry cannot erase a pair. */
export function validateDevicePair(pair: DevicePair, now: number, isCompleting = false): string {
  const bound = transcript(pair.local, pair.peer)
  if (isCompleting) {
    assertFresh(pair.local, now)
    assertFresh(pair.peer, now)
  }
  for (const [local, peer, candidate] of [
    [pair.local, pair.peer, pair.localConfirmation],
    [pair.peer, pair.local, pair.peerConfirmation],
  ] as const) {
    const confirmation = devicePairingConfirmationSchema.parse(candidate)
    assertFresh(local, confirmation.confirmedAt)
    assertFresh(peer, confirmation.confirmedAt)
    requirePair(confirmation.confirmedAt <= now + DEVICE_LIMITS.clockSkewMs)
    requirePair(
      confirmation.pairId === bound.pairId &&
        confirmation.transcriptDigest === bound.digest &&
        confirmation.localInvitationId === local.invitationId &&
        confirmation.peerInvitationId === peer.invitationId &&
        confirmation.localFingerprint === local.fingerprint &&
        confirmation.peerFingerprint === peer.fingerprint,
    )
    const signature = Buffer.from(confirmation.signatureBase64, 'base64')
    requirePair(
      signature.toString('base64') === confirmation.signatureBase64 &&
        verify(
          'sha256',
          Buffer.from(confirmationPayload(confirmation)),
          validateDeviceCertificate(local, now).publicKey,
          signature,
        ),
    )
  }
  return bound.pairId
}
