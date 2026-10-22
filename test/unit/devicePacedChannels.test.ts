// M100 lane C: one paced channel per pair over real pinned TLS 1.3. A real
// dialer and a real listener handshake through two pacers; ready resolves
// on both sides, a message crosses, and health echoes. Revoked and
// mismatched peers refuse before and without dialing, receiver pressure
// throttles, and close revokes every pending job.
import { constants, createHash } from 'node:crypto'
import { connect, createServer, type Server, type TLSSocket } from 'node:tls'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DeviceChannelDialFailure,
  PacedDeviceChannels,
  type DeviceChannelDialer,
  type DeviceChannelPeer,
  type MultiplexedDevicePort,
  type PacedDeviceChannel,
} from '../../src/host/devices/deviceChannel'
import type { MultiplexedDeviceMessage } from '../../src/core/devices/channel'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { deviceReadySchema, type DeviceReady, type DeviceThrottled } from '../../src/shared/devices'
import { levelLogger, type LoggedMessage } from './helpers/collectingLogger'
import { deviceTlsIdentity, type DeviceTlsIdentity } from './helpers/deviceTls'

const PAIR_ID = 'a'.repeat(32)
const INCARNATION = 'b'.repeat(32)

function hexId(value: number): string {
  return value.toString(16).padStart(32, '0')
}

function peerFor(identity: DeviceTlsIdentity, isActive = true): DeviceChannelPeer {
  return { pairId: PAIR_ID, peerFingerprint: identity.fingerprint, isActive: () => isActive }
}

function readyFor(requestId: string): DeviceReady {
  return deviceReadySchema.parse({
    version: DEVICE_LIMITS.protocolVersion,
    pairId: PAIR_ID,
    receiverIncarnationId: INCARNATION,
    requestId,
    // The multiplexed core requires every stream, never a subset.
    streams: ['control', 'status', 'events', 'logs', 'bulk'],
  })
}

interface CapturedMultiplexedPort {
  readonly port: MultiplexedDevicePort
  readonly received: MultiplexedDeviceMessage[]
  waitForReceive(): Promise<MultiplexedDeviceMessage>
}

function captureMultiplexedPort(): CapturedMultiplexedPort {
  const received: MultiplexedDeviceMessage[] = []
  const waiters: ((message: MultiplexedDeviceMessage) => void)[] = []
  let consumed = 0
  return {
    port: {
      connected: () => undefined,
      receive: (message: MultiplexedDeviceMessage): Promise<void> => {
        received.push(message)
        for (const wait of waiters.splice(0)) wait(message)
        return Promise.resolve()
      },
      disconnected: () => undefined,
    },
    received,
    waitForReceive: (): Promise<MultiplexedDeviceMessage> =>
      new Promise((resolve) => {
        const ready = received[consumed]
        if (ready === undefined) {
          waiters.push((next) => {
            consumed += 1
            resolve(next)
          })
        } else {
          consumed += 1
          resolve(ready)
        }
      }),
  }
}

function pinnedServer(local: DeviceTlsIdentity, peer: DeviceTlsIdentity): Server {
  return createServer({
    key: local.keyPem,
    cert: local.pem,
    ca: [peer.pem],
    requestCert: true,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.3',
    maxVersion: 'TLSv1.3',
    secureOptions: constants.SSL_OP_NO_TICKET,
    handshakeTimeout: DEVICE_LIMITS.handshakeDeadlineMs,
  })
}

function pinnedDialer(
  local: DeviceTlsIdentity,
  peer: DeviceTlsIdentity,
  port: number,
  dials: string[],
): DeviceChannelDialer {
  return {
    dial: (target: DeviceChannelPeer, signal: AbortSignal): Promise<TLSSocket> =>
      new Promise((resolve, reject) => {
        dials.push(target.pairId)
        const socket = connect({
          host: '127.0.0.1',
          port,
          key: local.keyPem,
          cert: local.pem,
          ca: [peer.pem],
          rejectUnauthorized: true,
          minVersion: 'TLSv1.3',
          maxVersion: 'TLSv1.3',
          secureOptions: constants.SSL_OP_NO_TICKET,
          checkServerIdentity: (_hostname, certificate) => {
            const raw = certificate.raw
            if (!Buffer.isBuffer(raw)) return new Error('unpaired')
            return createHash('sha256').update(raw).digest('hex') === peer.fingerprint
              ? undefined
              : new Error('unpaired')
          },
        })
        const onAbort = () => {
          socket.destroy()
          reject(new Error('revoked'))
        }
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
        socket.once('secureConnect', () => {
          signal.removeEventListener('abort', onAbort)
          resolve(socket)
        })
        socket.once('error', (error: Error) => {
          signal.removeEventListener('abort', onAbort)
          reject(error)
        })
      }),
  }
}

async function listenEphemeral(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('missing listener address')
  return address.port
}

describe('M100 paced channels', () => {
  const pacers: PacedDeviceChannels[] = []
  const servers: Server[] = []
  const logged: LoggedMessage[] = []
  const log = levelLogger(logged)
  afterEach(async () => {
    for (const pacer of pacers.splice(0)) pacer.close()
    for (const server of servers.splice(0)) {
      server.close()
      await new Promise((resolve) => server.once('close', resolve))
    }
  })

  function trackPacer(pacing: {
    throttled(state: DeviceThrottled): void
    authenticationRequired(pairId: string): void
  }): PacedDeviceChannels {
    const pacer = new PacedDeviceChannels(
      pinnedDialer(deviceTlsIdentity(hexId(1), 1), deviceTlsIdentity(hexId(2), 1), 1, []),
      pacing,
      log,
    )
    pacers.push(pacer)
    return pacer
  }

  it('handshakes over real pinned TLS: ready both sides, message crosses, health echoes', async () => {
    const dialerIdentity = deviceTlsIdentity(hexId(1), 1)
    const serverIdentity = deviceTlsIdentity(hexId(2), 1)
    const server = pinnedServer(serverIdentity, dialerIdentity)
    servers.push(server)
    const errors: string[] = []
    server.on('error', (error: Error) => {
      errors.push(error.message)
    })
    const port = await listenEphemeral(server)
    const dials: string[] = []
    const dialer = new PacedDeviceChannels(
      pinnedDialer(dialerIdentity, serverIdentity, port, dials),
      { throttled: () => undefined, authenticationRequired: () => undefined },
      log,
    )
    const acceptor = new PacedDeviceChannels(
      pinnedDialer(serverIdentity, dialerIdentity, port, dials),
      { throttled: () => undefined, authenticationRequired: () => undefined },
      log,
    )
    pacers.push(dialer, acceptor)
    const accepted: Promise<PacedDeviceChannel>[] = []
    const acceptorPort = captureMultiplexedPort()
    server.on('secureConnection', (socket: TLSSocket) => {
      socket.on('error', () => undefined)
      const pending = acceptor.accept(
        peerFor(dialerIdentity),
        readyFor(hexId(12)),
        acceptorPort.port,
        () => Promise.resolve(socket),
      )
      accepted.push(pending)
    })
    const dialerPort = captureMultiplexedPort()
    const channel = await dialer.connect(
      peerFor(serverIdentity),
      readyFor(hexId(11)),
      dialerPort.port,
    )
    await channel.ready
    expect(dials).toEqual([PAIR_ID])
    const [incoming] = accepted
    if (incoming === undefined) throw new Error('missing accepted channel')
    const receiver = await incoming
    await receiver.ready
    expect(channel.send({ kind: 'log', text: 'hello-pacer' })).toBe(true)
    const crossed = await acceptorPort.waitForReceive()
    expect(crossed).toMatchObject({ kind: 'log', text: 'hello-pacer' })
    const health = await channel.health()
    expect(health.pairId).toBe(PAIR_ID)
    expect(errors).toEqual([])
    // Live channels belong to their holder; the pacer only aborts handshakes.
    channel.close()
    receiver.close()
  })

  it('refuses a revoked peer before dialing', async () => {
    const dials: string[] = []
    const pacer = new PacedDeviceChannels(
      pinnedDialer(deviceTlsIdentity(hexId(3), 1), deviceTlsIdentity(hexId(4), 1), 1, dials),
      { throttled: () => undefined, authenticationRequired: () => undefined },
      log,
    )
    pacers.push(pacer)
    await expect(
      pacer.connect(
        peerFor(deviceTlsIdentity(hexId(4), 1), false),
        readyFor(hexId(13)),
        captureMultiplexedPort().port,
      ),
    ).rejects.toThrow('revoked')
    expect(dials).toEqual([])
  })

  it('refuses a changed fingerprint on a live job as authentication', async () => {
    const dials: string[] = []
    const pacer = new PacedDeviceChannels(
      pinnedDialer(deviceTlsIdentity(hexId(5), 1), deviceTlsIdentity(hexId(6), 1), 1, dials),
      { throttled: () => undefined, authenticationRequired: () => undefined },
      log,
    )
    pacers.push(pacer)
    const pending = pacer.connect(
      peerFor(deviceTlsIdentity(hexId(6), 1)),
      readyFor(hexId(14)),
      captureMultiplexedPort().port,
    )
    await expect(
      pacer.connect(
        { pairId: PAIR_ID, peerFingerprint: 'f'.repeat(64), isActive: () => true },
        readyFor(hexId(15)),
        captureMultiplexedPort().port,
      ),
    ).rejects.toThrow(DeviceChannelDialFailure)
    pacer.close()
    await expect(pending).rejects.toThrow('revoked')
  })

  it('throttles receiver pressure as capacity', async () => {
    const throttled: DeviceThrottled[] = []
    const pacer = trackPacer({
      throttled: (state) => {
        throttled.push(state)
      },
      authenticationRequired: () => undefined,
    })
    const identity = deviceTlsIdentity(hexId(7), 1)
    const hung = pacer.accept(
      peerFor(identity),
      readyFor(hexId(16)),
      captureMultiplexedPort().port,
      () => new Promise<TLSSocket>(() => undefined),
    )
    await expect(
      pacer.accept(
        peerFor(identity),
        readyFor(hexId(17)),
        captureMultiplexedPort().port,
        () => new Promise<TLSSocket>(() => undefined),
      ),
    ).rejects.toThrow('capacity')
    expect(throttled.map((state) => state.reason)).toContain('pressure')
    pacer.close()
    await expect(hung).rejects.toThrow('revoked')
  })

  it('only confirmed retry clears authentication, never an unknown or live job', async () => {
    const pacer = trackPacer({
      throttled: () => undefined,
      authenticationRequired: () => undefined,
    })
    expect(pacer.retryAuthentication('0'.repeat(32), true)).toBe(false)
    const pending = pacer.connect(
      peerFor(deviceTlsIdentity(hexId(8), 1)),
      readyFor(hexId(18)),
      captureMultiplexedPort().port,
    )
    expect(pacer.retryAuthentication(PAIR_ID, false)).toBe(false)
    expect(pacer.retryAuthentication(PAIR_ID, true)).toBe(false)
    pacer.close()
    await expect(pending).rejects.toThrow('revoked')
  })

  it('close revokes pending jobs and later connects', async () => {
    const pacer = trackPacer({
      throttled: () => undefined,
      authenticationRequired: () => undefined,
    })
    const pending = pacer.connect(
      peerFor(deviceTlsIdentity(hexId(9), 1)),
      readyFor(hexId(19)),
      captureMultiplexedPort().port,
    )
    pacer.close()
    await expect(pending).rejects.toThrow('revoked')
    await expect(
      pacer.connect(
        peerFor(deviceTlsIdentity(hexId(9), 1)),
        readyFor(hexId(20)),
        captureMultiplexedPort().port,
      ),
    ).rejects.toThrow('revoked')
  })
})
