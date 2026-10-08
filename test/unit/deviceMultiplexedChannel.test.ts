import { constants } from 'node:crypto'
import net from 'node:net'
import { connect, createServer, type Server, type TLSSocket } from 'node:tls'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import {
  openMultiplexedDeviceChannel,
  type PacedDeviceChannel,
  type MultiplexedDevicePort,
} from '../../src/host/devices/deviceChannel'
import {
  bulkMessage,
  channelPeer,
  channelGrantRequest,
  channelPacket,
  settleChannel,
  channelPort,
  channelReady,
  fakeChannelSocket,
  stopMessage,
} from './helpers/multiplexedChannelFixtures'
import { transportClock, transportIdentity } from './helpers/deviceTransportFixtures'

const channels = new Set<PacedDeviceChannel>()
const sockets = new Set<TLSSocket>()
const servers = new Set<Server>()
afterEach(async () => {
  for (const channel of channels) channel.close()
  for (const socket of sockets) socket.destroy()
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve()
          })
        }),
    ),
  )
  channels.clear()
  sockets.clear()
  servers.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function carriage(shouldAnswerReady = true) {
  const fixture = fakeChannelSocket(channelReady, shouldAnswerReady)
  sockets.add(fixture.socket)
  const peer = channelPeer()
  const port = channelPort()
  const channel = openMultiplexedDeviceChannel(fixture.socket, peer, channelReady, false, port)
  channels.add(channel)
  void settleChannel(channel.ready)
  return { ...fixture, peer, port, channel }
}
function tick() {
  return new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
}

describe('TLS carriage and authenticated health', () => {
  it('health sends only an authenticated ready call, and rejects data before its reply', async () => {
    const probe = vi.spyOn(net, 'connect').mockImplementation(() => new net.Socket())
    const fixture = carriage()
    expect(fixture.port.connected).not.toHaveBeenCalled()
    expect(() => fixture.channel.send(stopMessage)).toThrow('unknown')
    await fixture.channel.ready
    expect(fixture.port.connected).toHaveBeenCalledOnce()
    await fixture.channel.health()
    expect(fixture.port.connected).toHaveBeenCalledOnce()
    const messages = fixture.write.mock.calls.map(([bytes]) =>
      new TextDecoder().decode(typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes),
    )
    expect(messages[0]).toContain('ready')
    expect(messages.every((message) => !message.includes('probe'))).toBe(true)
    expect(probe).not.toHaveBeenCalled()
  })
  it.each(['unauthorized', 'pin', 'protocol', 'ticket', 'revoked'])(
    'rejects %s TLS before a ready call or application callback',
    (guard) => {
      const fixture = fakeChannelSocket()
      sockets.add(fixture.socket)
      const peer = channelPeer()
      switch (guard) {
        case 'unauthorized': {
          fixture.socket.authorized = false
          break
        }
        case 'pin': {
          Object.assign(peer, { peerFingerprint: 'f'.repeat(64) })
          break
        }
        case 'protocol': {
          vi.spyOn(fixture.socket, 'getProtocol').mockReturnValue('TLSv1.2')
          break
        }
        case 'ticket': {
          vi.spyOn(fixture.socket, 'isSessionReused').mockReturnValue(true)
          break
        }
        case 'revoked': {
          peer.isActive = () => false
          break
        }
        default: {
          throw new Error('fixture guard')
        }
      }
      const port = channelPort()
      expect(() =>
        openMultiplexedDeviceChannel(fixture.socket, peer, channelReady, false, port),
      ).toThrow('authentication')
      expect(fixture.write).not.toHaveBeenCalled()
      expect(port.connected).not.toHaveBeenCalled()
      expect(fixture.socket.destroyed).toBe(true)
    },
  )
  it('honors socket write backpressure and prioritizes Stop at the next drain', async () => {
    const fixture = carriage()
    await fixture.channel.ready
    await tick()
    fixture.write.mockReset().mockReturnValue(false)
    expect(fixture.channel.send(bulkMessage)).toBe(true)
    expect(fixture.write).toHaveBeenCalledOnce()
    fixture.channel.send(stopMessage)
    expect(fixture.write).toHaveBeenCalledOnce()
    fixture.write.mockReturnValue(true)
    fixture.socket.emit('drain')
    const packet = channelPacket(fixture.write.mock.calls[1]![0])
    expect(packet['stream']).toBe('control')
    for (const [bytes] of fixture.write.mock.calls)
      expect(
        typeof bytes === 'string' ? new TextEncoder().encode(bytes).byteLength : bytes.byteLength,
      ).toBeLessThanOrEqual(DEVICE_LIMITS.channelFrameBytes)
    expect(fixture.socket.destroyed).toBe(false)
  })
  it.each(['log', 'grantRequest'] as const)(
    'delivers Stop while an application %s handler is held and does not ack it early',
    async (kind) => {
      const fixture = carriage()
      await fixture.channel.ready
      const held = Promise.withResolvers<undefined>()
      fixture.port.receive = vi.fn<MultiplexedDevicePort['receive']>((message) =>
        message.kind === kind ? held.promise : Promise.resolve(),
      )
      fixture.remote.enqueue(
        kind === 'log' ? { kind, text: 'held' } : { kind, request: channelGrantRequest() },
      )
      fixture.flush()
      await tick()
      fixture.remote.enqueue(stopMessage)
      fixture.flush()
      await tick()
      expect(fixture.port.receive).toHaveBeenCalledTimes(2)
      expect(fixture.port.receive).toHaveBeenLastCalledWith(stopMessage, fixture.channel)
      const acks = fixture.write.mock.calls.map(([bytes]) => channelPacket(bytes))
      expect(
        acks.some(
          (packet) =>
            packet['kind'] === 'ack' && packet['stream'] === (kind === 'log' ? 'logs' : 'events'),
        ),
      ).toBe(false)
      held.resolve(undefined)
      await tick()
      const completed = fixture.write.mock.calls.map(([bytes]) => channelPacket(bytes))
      expect(
        completed.some(
          (packet) =>
            packet['kind'] === 'ack' && packet['stream'] === (kind === 'log' ? 'logs' : 'events'),
        ),
      ).toBe(true)
    },
  )
  it('reports pressure explicitly and retains the connection so Stop remains available', async () => {
    const fixture = carriage()
    await fixture.channel.ready
    fixture.write.mockReset().mockReturnValue(false)
    for (let index = 0; index < DEVICE_LIMITS.queuedFrames; index += 1)
      expect(fixture.channel.send({ kind: 'log', text: 'queued' })).toBe(true)
    expect(fixture.channel.send({ kind: 'log', text: 'overflow' })).toBe(false)
    expect(fixture.channel.send(stopMessage)).toBe(true)
    expect(fixture.channel.closed).toBe(false)
  })
  it('silence is unknown at the ready deadline, never a healthy TCP port', async () => {
    vi.useFakeTimers()
    const fixture = carriage(false)
    await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.handshakeDeadlineMs)
    await expect(fixture.channel.ready).rejects.toThrow('unknown')
    expect(fixture.port.connected).not.toHaveBeenCalled()
    expect(fixture.channel.closed).toBe(true)
  })
  it.each(['monotonic', 'wall-backwards', 'timer'])(
    'bounds a trickled incomplete bulk message by the absolute %s deadline',
    async (clock) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
      const time = transportClock()
      const fixture = carriage()
      await fixture.channel.ready
      fixture.remote.enqueue(bulkMessage)
      fixture.socket.emit('data', Buffer.from(fixture.remote.nextPacket()!))
      time.wall += 1
      if (clock === 'monotonic') time.monotonic += DEVICE_LIMITS.frameDeadlineMs
      else if (clock === 'wall-backwards') time.wall -= 2
      if (clock === 'timer') await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.frameDeadlineMs)
      else fixture.socket.emit('data', Buffer.from(fixture.remote.nextPacket()!))
      expect(fixture.channel.closed).toBe(true)
      expect(fixture.port.receive).not.toHaveBeenCalled()
    },
  )
  it('rechecks revocation before sending and before each queued delivery and scrubs handler errors', async () => {
    const fixture = carriage()
    await fixture.channel.ready
    const held = Promise.withResolvers<undefined>()
    fixture.port.receive = vi.fn(() => held.promise)
    fixture.remote.enqueue({ kind: 'log', text: 'first' })
    fixture.remote.enqueue({ kind: 'log', text: 'second' })
    fixture.flush()
    await tick()
    fixture.peer.isActive = () => false
    held.resolve(undefined)
    await tick()
    expect(fixture.port.receive).toHaveBeenCalledOnce()
    expect(fixture.channel.closed).toBe(true)
    const errorFixture = carriage()
    await errorFixture.channel.ready
    errorFixture.port.receive = vi.fn(() => Promise.reject(new Error('synthetic-private-detail')))
    errorFixture.remote.enqueue(stopMessage)
    errorFixture.flush()
    await tick()
    expect(errorFixture.channel.closed).toBe(true)
    expect(
      errorFixture.write.mock.calls.some(([bytes]) =>
        JSON.stringify(channelPacket(bytes)).includes('synthetic-private-detail'),
      ),
    ).toBe(false)
  })
  it('rejects a malformed frame before any application delivery and tears down once', async () => {
    const fixture = carriage()
    await fixture.channel.ready
    fixture.socket.emit('data', Buffer.from('{}\n'))
    await tick()
    expect(fixture.channel.closed).toBe(true)
    expect(fixture.port.receive).not.toHaveBeenCalled()
    expect(fixture.port.disconnected).toHaveBeenCalledOnce()
  })
  it('keeps a channel alive with authenticated ready calls and closes a failed health wait', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'],
    })
    const fixture = carriage()
    await fixture.channel.ready
    const initialCalls = fixture.write.mock.calls.length
    await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.idleConnectionMs / 2)
    expect(fixture.write.mock.calls.length).toBeGreaterThan(initialCalls)
    expect(fixture.channel.closed).toBe(false)
    fixture.write.mockReset().mockReturnValue(true)
    const wait = settleChannel(fixture.channel.health())
    await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.handshakeDeadlineMs)
    await wait
    expect(fixture.channel.closed).toBe(true)
  })
  it('fails closed on revoked outbound traffic and a full socket buffer', async () => {
    const revoked = carriage()
    await revoked.channel.ready
    revoked.peer.isActive = () => false
    expect(() => revoked.channel.send(stopMessage)).toThrow('authentication')
    expect(revoked.channel.failure).toBe('authentication')
    const full = carriage()
    await full.channel.ready
    Object.defineProperty(full.socket, 'writableLength', { value: DEVICE_LIMITS.frameBytes })
    const calls = full.write.mock.calls.length
    expect(() => full.channel.send(stopMessage)).toThrow('capacity')
    expect(full.write).toHaveBeenCalledTimes(calls)
    expect(full.channel.closed).toBe(true)
  })
})

describe('real mutually authenticated loopback TLS', () => {
  let clientIdentity: ReturnType<typeof transportIdentity>
  let serverIdentity: ReturnType<typeof transportIdentity>
  beforeAll(() => {
    clientIdentity = transportIdentity()
    serverIdentity = transportIdentity()
  })
  it('uses one long-lived TLS socket for ready, logs, bulk and independent Stop delivery', async () => {
    const receiverPort = channelPort()
    const held = Promise.withResolvers<undefined>()
    const receivedLog = Promise.withResolvers<undefined>()
    const receivedStop = Promise.withResolvers<undefined>()
    receiverPort.receive = vi.fn<MultiplexedDevicePort['receive']>((message) => {
      if (message.kind === 'log') {
        receivedLog.resolve(undefined)
        return held.promise
      }
      if (message.kind === 'frame' && message.frame.body.kind === 'cancel')
        receivedStop.resolve(undefined)
      return Promise.resolve()
    })
    const accepted = vi.fn()
    const server = createServer(
      {
        key: serverIdentity.privateKey,
        cert: serverIdentity.certificate,
        ca: [clientIdentity.certificate],
        requestCert: true,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.3',
        maxVersion: 'TLSv1.3',
        secureOptions: constants.SSL_OP_NO_TICKET,
      },
      (socket) => {
        sockets.add(socket)
        accepted()
        const receiver = openMultiplexedDeviceChannel(
          socket,
          { ...channelPeer(), peerFingerprint: clientIdentity.fingerprint },
          channelReady,
          true,
          receiverPort,
        )
        channels.add(receiver)
        void settleChannel(receiver.ready)
      },
    )
    servers.add(server)
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('fixture address')
    const socket = connect({
      host: '127.0.0.1',
      port: address.port,
      key: clientIdentity.privateKey,
      cert: clientIdentity.certificate,
      ca: [serverIdentity.certificate],
      rejectUnauthorized: true,
      minVersion: 'TLSv1.3',
      maxVersion: 'TLSv1.3',
      secureOptions: constants.SSL_OP_NO_TICKET,
      checkServerIdentity: () => undefined,
    })
    sockets.add(socket)
    await new Promise<void>((resolve, reject) => {
      socket.once('secureConnect', resolve)
      socket.once('error', reject)
    })
    const source = openMultiplexedDeviceChannel(
      socket,
      { ...channelPeer(), peerFingerprint: serverIdentity.fingerprint },
      channelReady,
      false,
      channelPort(),
    )
    channels.add(source)
    await source.ready
    source.send({ kind: 'log', text: 'held real TLS log' })
    await receivedLog.promise
    source.send(bulkMessage)
    source.send(stopMessage)
    await receivedStop.promise
    expect(accepted).toHaveBeenCalledOnce()
    expect(source.closed).toBe(false)
    await source.health()
    held.resolve(undefined)
  })
})
