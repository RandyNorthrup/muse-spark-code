// A real local TLS design probe, not the production transport's certification.
// Keys exist only in this process; no openssl child, disk fixture or dependency.
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
  X509Certificate,
  constants,
} from 'node:crypto'
import { connect, createServer, type TLSSocket } from 'node:tls'
import { describe, expect, it } from 'vitest'

function der(tag: number, ...parts: Buffer[]): Buffer {
  const value = Buffer.concat(parts)
  const size = value.length
  let length = Buffer.from([size])
  if (size >= 128) {
    const octets = [size & 0xff]
    if (size >= 256) octets.unshift(size >> 8)
    length = Buffer.from([0x80 | octets.length, ...octets])
  }
  return Buffer.concat([Buffer.from([tag]), length, value])
}
function sequence(...parts: Buffer[]): Buffer {
  return der(0x30, ...parts)
}
function identity() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const algorithm = sequence(Buffer.from('06082a8648ce3d040302', 'hex'))
  const name = sequence(
    der(
      0x31,
      sequence(Buffer.from('0603550403', 'hex'), der(0x0c, Buffer.from('muse-device-pair'))),
    ),
  )
  const extensions = der(
    0xa3,
    sequence(
      sequence(
        Buffer.from('0603551d13', 'hex'),
        der(0x01, Buffer.from([0xff])),
        der(0x04, sequence(der(0x01, Buffer.from([0xff])), der(0x02, Buffer.from([0])))),
      ),
      sequence(
        Buffer.from('0603551d0f', 'hex'),
        der(0x01, Buffer.from([0xff])),
        der(0x04, der(0x03, Buffer.from([2, 0x84]))),
      ),
      sequence(
        Buffer.from('0603551d25', 'hex'),
        der(
          0x04,
          sequence(
            Buffer.from('06082b06010505070301', 'hex'),
            Buffer.from('06082b06010505070302', 'hex'),
          ),
        ),
      ),
    ),
  )
  const tbs = sequence(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(
      0x02,
      Buffer.concat([
        Buffer.from([0]),
        Buffer.from(randomBytes(16).map((byte, index) => (index === 0 ? byte | 0x80 : byte))),
      ]),
    ),
    algorithm,
    name,
    sequence(der(0x17, Buffer.from('260101000000Z')), der(0x17, Buffer.from('310101000000Z'))),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    extensions,
  )
  const certificate = sequence(
    tbs,
    algorithm,
    der(0x03, Buffer.concat([Buffer.from([0]), sign('sha256', tbs, privateKey)])),
  )
  return {
    certificate,
    privateKey,
    parsed: new X509Certificate(certificate),
    pem: `-----BEGIN CERTIFICATE-----\n${certificate.toString('base64')}\n-----END CERTIFICATE-----`,
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    fingerprint: createHash('sha256').update(certificate).digest('hex'),
  }
}

describe('M100 certificate and TLS design probe', () => {
  it('uses built-in P-256 signing and an exact self-signed per-pair certificate', () => {
    const first = identity()
    const second = identity()
    expect(first.parsed.verify(first.parsed.publicKey)).toBe(true)
    expect(first.parsed.checkPrivateKey(first.privateKey)).toBe(true)
    expect(first.parsed.verify(second.parsed.publicKey)).toBe(false)
    expect(first.certificate.length).toBeLessThan(3072)
    expect(first.fingerprint).not.toBe(second.fingerprint)
    expect(first.parsed.ca).toBe(true)
    expect(first.parsed.subject).toBe('CN=muse-device-pair')
  })

  it('keeps CA verification on, requires client possession, checks the exact server pin and refuses resumption', async () => {
    const source = identity()
    const receiver = identity()
    const attacker = identity()
    // The same real-ticket probe must resume with controls off and refuse with them on.
    for (const shouldRefuseResumption of [false, true]) {
      const sockets = new Set<TLSSocket>()
      let admitted = 0
      const server = createServer(
        {
          key: receiver.key,
          cert: receiver.pem,
          ca: [source.pem],
          requestCert: true,
          rejectUnauthorized: true,
          minVersion: 'TLSv1.3',
          maxVersion: 'TLSv1.3',
          secureOptions: shouldRefuseResumption ? constants.SSL_OP_NO_TICKET : 0,
        },
        (socket) => {
          sockets.add(socket)
          const raw = socket.getPeerCertificate().raw
          if (
            !socket.authorized ||
            createHash('sha256').update(raw).digest('hex') !== source.fingerprint ||
            (shouldRefuseResumption && socket.isSessionReused())
          ) {
            socket.destroy()
            return
          }
          admitted += 1
          socket.end('accepted')
        },
      )
      if (shouldRefuseResumption) {
        server.on('resumeSession', (_sessionId, callback) => {
          callback(null, null)
        })
      }
      server.on('tlsClientError', () => undefined)
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('Missing test listener')
      const exchange = (
        client: ReturnType<typeof identity> | undefined,
        pin: string,
        session?: Buffer,
      ) =>
        new Promise<{ accepted: boolean; reused: boolean; session: Buffer | undefined }>(
          (resolve) => {
            const socket = connect({
              host: '127.0.0.1',
              port: address.port,
              ca: [receiver.pem],
              rejectUnauthorized: true,
              minVersion: 'TLSv1.3',
              maxVersion: 'TLSv1.3',
              ...(client !== undefined && { key: client.key, cert: client.pem }),
              ...(session !== undefined && { session }),
              checkServerIdentity: (_hostname, certificate) =>
                createHash('sha256').update(certificate.raw).digest('hex') === pin
                  ? undefined
                  : new Error('Test pin mismatch'),
            })
            sockets.add(socket)
            let isAccepted = false
            let isReused = false
            let savedSession: Buffer | undefined
            socket.on('secureConnect', () => {
              isReused = socket.isSessionReused()
            })
            socket.on('session', (ticket: Buffer) => {
              savedSession = ticket
            })
            socket.on('data', (data: Buffer) => {
              isAccepted = data.toString() === 'accepted'
            })
            socket.on('error', () => undefined)
            socket.on('close', () => {
              resolve({ accepted: isAccepted, reused: isReused, session: savedSession })
            })
            socket.setTimeout(10_000, () => socket.destroy())
          },
        )
      try {
        const first = await exchange(source, receiver.fingerprint)
        expect(first.accepted).toBe(true)
        expect(first.reused).toBe(false)
        const anonymous = await exchange(undefined, receiver.fingerprint)
        const wrongClient = await exchange(attacker, receiver.fingerprint)
        const wrongServer = await exchange(source, attacker.fingerprint)
        expect(anonymous.accepted).toBe(false)
        expect(wrongClient.accepted).toBe(false)
        expect(wrongServer.accepted).toBe(false)
        const again = await exchange(source, receiver.fingerprint, first.session)
        expect(again.accepted).toBe(true)
        expect(first.session).toBeDefined()
        expect(again.reused).toBe(!shouldRefuseResumption)
        expect(admitted).toBe(2)
      } finally {
        for (const socket of sockets) socket.destroy()
        await new Promise<void>((resolve) =>
          server.close(() => {
            resolve()
          }),
        )
      }
    }
  })
})
