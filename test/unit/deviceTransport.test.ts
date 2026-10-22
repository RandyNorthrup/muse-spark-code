import { afterEach, describe, expect, it } from 'vitest'
import { DeviceTransport, type DeviceTransportPair } from '../../src/host/devices/deviceTransport'
import type { DeviceChannel, DeviceChannelPort } from '../../src/host/devices/deviceChannel'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { levelLogger, type LoggedMessage } from './helpers/collectingLogger'
import { deviceTlsIdentity, type DeviceTlsIdentity } from './helpers/deviceTls'
import type { DeviceFrame } from '../../src/shared/devices'

const PAIR_ID = 'a'.repeat(32)
const INCARNATION = 'b'.repeat(32)
const PORT_BASE = 18_443

function hexId(value: number): string {
  return value.toString(16).padStart(32, '0')
}

function testIdentity(deviceId: string): DeviceTlsIdentity {
  return deviceTlsIdentity(deviceId, PORT_BASE)
}

function pair(local: DeviceTlsIdentity, peer: DeviceTlsIdentity): DeviceTransportPair {
  return {
    pairId: PAIR_ID,
    receiverIncarnationId: INCARNATION,
    certificate: local.pem,
    privateKey: local.keyPem,
    fingerprint: local.fingerprint,
    peerCertificate: peer.pem,
    peerFingerprint: peer.fingerprint,
    isActive: () => true,
    isOffered: () => true,
  }
}

const logged: LoggedMessage[] = []
const log = levelLogger(logged)

interface CapturedPort {
  readonly port: DeviceChannelPort
  readonly connectedChannels: DeviceChannel[]
  readonly received: DeviceFrame[]
  readonly disconnected: string[]
  waitForConnected(): Promise<DeviceChannel>
  waitForReceive(): Promise<DeviceFrame>
}

function capturePort(): CapturedPort {
  const connectedChannels: DeviceChannel[] = []
  const received: DeviceFrame[] = []
  const disconnected: string[] = []
  const connectedWaiters: ((channel: DeviceChannel) => void)[] = []
  const receiveWaiters: ((frame: DeviceFrame) => void)[] = []
  let consumedConnects = 0
  let consumedReceives = 0
  return {
    port: {
      connected: (channel: DeviceChannel): void => {
        connectedChannels.push(channel)
        for (const wait of connectedWaiters.splice(0)) wait(channel)
      },
      receive: (frame: DeviceFrame): Promise<void> => {
        received.push(frame)
        for (const wait of receiveWaiters.splice(0)) wait(frame)
        return Promise.resolve()
      },
      disconnected: (reason: string): void => {
        disconnected.push(reason)
      },
    },
    connectedChannels,
    received,
    disconnected,
    waitForConnected: (): Promise<DeviceChannel> =>
      new Promise((resolve) => {
        const ready = connectedChannels[consumedConnects]
        if (ready === undefined) {
          connectedWaiters.push((channel) => {
            consumedConnects += 1
            resolve(channel)
          })
        } else {
          consumedConnects += 1
          resolve(ready)
        }
      }),
    waitForReceive: (): Promise<DeviceFrame> =>
      new Promise((resolve) => {
        const ready = received[consumedReceives]
        if (ready === undefined) {
          receiveWaiters.push((next) => {
            consumedReceives += 1
            resolve(next)
          })
        } else {
          consumedReceives += 1
          resolve(ready)
        }
      }),
  }
}

function frame(body: DeviceFrame['body'], requestId: string): DeviceFrame {
  return {
    version: DEVICE_LIMITS.protocolVersion,
    pairId: PAIR_ID,
    receiverIncarnationId: INCARNATION,
    requestId,
    body,
  }
}

describe('M100 device transport over loopback TLS', () => {
  const transports: DeviceTransport[] = []
  const cleanups: (() => void)[] = []
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup()
    for (const transport of transports.splice(0)) transport.revoke(PAIR_ID)
  })

  async function listenOnFreePort(
    transport: DeviceTransport,
    entry: DeviceTransportPair,
    handler: DeviceChannelPort,
  ): Promise<number> {
    let lastError: unknown
    for (let port = PORT_BASE; port < PORT_BASE + 8; port += 1) {
      try {
        const unlisten = await transport.listen(entry, '127.0.0.1', port, handler)
        cleanups.push(unlisten)
        return port
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }

  it('connects, exchanges opening offers and round-trips frames both ways', async () => {
    const sideA = testIdentity(hexId(1))
    const sideB = testIdentity(hexId(2))
    const listener = new DeviceTransport(log)
    const dialer = new DeviceTransport(log)
    transports.push(listener, dialer)
    const heardA = capturePort()
    const heardB = capturePort()
    const port = await listenOnFreePort(listener, pair(sideA, sideB), heardA.port)
    const connectedB = dialer.connect(
      pair(sideB, sideA),
      '127.0.0.1',
      port,
      '127.0.0.1',
      heardB.port,
    )
    const channelA = await heardA.waitForConnected()
    cleanups.push(() => {
      channelA.close()
    })
    channelA.send(frame({ kind: 'offers', offers: [] }, hexId(10)))
    const channelB = await connectedB
    cleanups.push(() => {
      channelB.close()
    })
    const opening = await heardB.waitForReceive()
    expect(opening.body).toEqual({ kind: 'offers', offers: [] })
    await heardB.waitForConnected()
    const identity = {
      pairId: PAIR_ID,
      receiverIncarnationId: INCARNATION,
      boardId: hexId(20),
      taskId: hexId(21),
      attemptId: hexId(22),
    }
    channelB.send(frame({ kind: 'reconcile', identities: [identity] }, hexId(11)))
    const seenA = await heardA.waitForReceive()
    expect(seenA.body).toEqual({ kind: 'reconcile', identities: [identity] })
    channelA.send(frame({ kind: 'reconcile', identities: [identity] }, hexId(12)))
    const toB = await heardB.waitForReceive()
    expect(toB.body).toEqual({ kind: 'reconcile', identities: [identity] })
    expect(channelB.pairId).toBe(PAIR_ID)
  })

  it('refuses a peer pin that does not match before dialing', async () => {
    const sideA = testIdentity(hexId(3))
    const sideB = testIdentity(hexId(4))
    const dialer = new DeviceTransport(log)
    transports.push(dialer)
    const entry = pair(sideB, sideA)
    const tampered: DeviceTransportPair = { ...entry, peerFingerprint: 'c'.repeat(64) }
    await expect(
      dialer.connect(tampered, '127.0.0.1', PORT_BASE, '127.0.0.1', capturePort().port),
    ).rejects.toThrow('unpaired')
  })

  it('refuses a peer that presents a certificate outside the pin', async () => {
    const sideA = testIdentity(hexId(5))
    const sideB = testIdentity(hexId(6))
    const stranger = testIdentity(hexId(7))
    const listener = new DeviceTransport(log)
    const dialer = new DeviceTransport(log)
    transports.push(listener, dialer)
    const impostor: DeviceTransportPair = {
      ...pair(sideA, sideB),
      certificate: stranger.pem,
      privateKey: stranger.keyPem,
      fingerprint: stranger.fingerprint,
    }
    const port = await listenOnFreePort(listener, impostor, capturePort().port)
    await expect(
      dialer.connect(pair(sideB, sideA), '127.0.0.1', port, '127.0.0.1', capturePort().port),
    ).rejects.toThrow('blocked-or-unreachable')
  })

  it('refuses inactive pairs and double listens with unpaired', async () => {
    const sideA = testIdentity(hexId(8))
    const sideB = testIdentity(hexId(9))
    const transport = new DeviceTransport(log)
    transports.push(transport)
    const entry = pair(sideA, sideB)
    const idle: DeviceTransportPair = { ...entry, isActive: () => false }
    await expect(
      transport.connect(idle, '127.0.0.1', PORT_BASE, '127.0.0.1', capturePort().port),
    ).rejects.toThrow('unpaired')
    await listenOnFreePort(transport, entry, capturePort().port)
    await expect(
      transport.listen(entry, '127.0.0.1', PORT_BASE + 7, capturePort().port),
    ).rejects.toThrow('unpaired')
  })
})
