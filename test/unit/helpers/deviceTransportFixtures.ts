import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { createServer } from 'node:net'
import { type DeviceFrame } from '../../../src/shared/devices'
import { type DeviceTransportPair } from '../../../src/host/devices/deviceTransport'
import { type DeviceChannel, type DeviceChannelPort } from '../../../src/host/devices/deviceChannel'
import { vi } from 'vitest'

// Fixed test-only X.509 profile; Node supplies all key/signature mathematics.
// Identities stay in memory. A CA-signed child has a different leaf pin.
function element(tag: number, payload: Buffer): Buffer {
  const length: number[] = []
  let remaining = payload.length
  do {
    length.unshift(remaining % 256)
    remaining = Math.floor(remaining / 256)
  } while (remaining > 0)
  const prefix = payload.length < 128 ? [payload.length] : [0x80 + length.length, ...length]
  return Buffer.concat([Buffer.from([tag, ...prefix]), payload])
}

export function transportIdentity(parent?: { certificate: string; privateKey: string }) {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const algorithm = Buffer.from('300a06082a8648ce3d040302', 'hex')
  const name = Buffer.from('301b3119301706035504030c106d7573652d6465766963652d74657374', 'hex')
  const subject =
    parent === undefined
      ? name
      : element(
          0x30,
          element(
            0x31,
            element(
              0x30,
              Buffer.concat([
                Buffer.from('0603550403', 'hex'),
                element(0x0c, Buffer.from('muse-device-child')),
              ]),
            ),
          ),
        )
  const date = (offset: number) =>
    element(
      0x18,
      Buffer.from(
        new Date(Date.now() + offset).toISOString().replaceAll(/\D/g, '').slice(0, 14) + 'Z',
      ),
    )
  const extensions = Buffer.concat([
    Buffer.from(
      parent === undefined
        ? '30120603551d130101ff040830060101ff020100'
        : '300c0603551d130101ff04023000',
      'hex',
    ),
    Buffer.from(
      parent === undefined
        ? '300e0603551d0f0101ff040403020284'
        : '300e0603551d0f0101ff040403020780',
      'hex',
    ),
    Buffer.from('301d0603551d250416301406082b0601050507030106082b06010505070302', 'hex'),
  ])
  const serial = Buffer.concat([Buffer.from([0]), randomBytes(16)])
  serial[1] = (serial[1] ?? 0) | 0x80
  const body = element(
    0x30,
    Buffer.concat([
      Buffer.from('a003020102', 'hex'),
      element(0x02, serial),
      algorithm,
      name,
      element(0x30, Buffer.concat([date(-86_400_000), date(86_400_000)])),
      subject,
      keys.publicKey.export({ type: 'spki', format: 'der' }),
      element(0xa3, element(0x30, extensions)),
    ]),
  )
  const signer = parent === undefined ? keys.privateKey : createPrivateKey(parent.privateKey)
  const bytes = element(
    0x30,
    Buffer.concat([
      body,
      algorithm,
      element(0x03, Buffer.concat([Buffer.from([0]), sign('sha256', body, signer)])),
    ]),
  )
  return {
    certificate: [
      '-----BEGIN CERTIFICATE-----',
      bytes.toString('base64'),
      '-----END CERTIFICATE-----',
    ].join('\n'),
    privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    fingerprint: createHash('sha256').update(bytes).digest('hex'),
  }
}

export async function transportPort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const address = probe.address()
  if (address === null || typeof address === 'string') throw new Error('Missing test port')
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    }),
  )
  return address.port
}

export const deviceTestFrame: DeviceFrame = {
  version: 1,
  pairId: 'a'.repeat(32),
  receiverIncarnationId: 'b'.repeat(32),
  requestId: 'c'.repeat(32),
  body: { kind: 'offers', offers: [] },
}

export function transportPair(
  local: ReturnType<typeof transportIdentity>,
  peer: ReturnType<typeof transportIdentity>,
): DeviceTransportPair {
  return {
    ...local,
    pairId: deviceTestFrame.pairId,
    receiverIncarnationId: deviceTestFrame.receiverIncarnationId,
    peerCertificate: peer.certificate,
    peerFingerprint: peer.fingerprint,
    isActive: () => true,
    isOffered: () => true,
  }
}

export function transportHandler(shouldAnnounce = true): DeviceChannelPort {
  return {
    connected: vi.fn((channel: DeviceChannel) => {
      if (shouldAnnounce && channel.isReceiver && channel.receiverIncarnationId !== undefined)
        channel.send({
          ...deviceTestFrame,
          pairId: channel.pairId,
          receiverIncarnationId: channel.receiverIncarnationId,
        })
    }),
    receive: vi.fn(() => Promise.resolve()),
    disconnected: vi.fn(),
  }
}
