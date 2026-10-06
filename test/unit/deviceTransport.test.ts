import { connect as tlsConnect, createServer as tlsServer, TLSSocket } from 'node:tls'
import { connect as tcpConnect, createServer as tcpServer, Server, Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceTransport, type DeviceTransportPair } from '../../src/host/devices/deviceTransport'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { DeviceFrameDecoder, encodeDeviceFrame } from '../../src/core/devices/deviceFraming'
import { type DeviceChannel } from '../../src/host/devices/deviceChannel'
import { type DeviceFrame } from '../../src/shared/devices'
import {
  deviceTestFrame,
  transportHandler,
  transportClock,
  transportIdentity,
  transportPair,
  transportPort,
} from './helpers/deviceTransportFixtures'

const source = transportIdentity()
const receiver = transportIdentity()
const attacker = transportIdentity()
const transports = new Set<DeviceTransport>()
const peers = new Set<TLSSocket>()
const pairs = new Set<string>()
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const peer of peers) peer.destroy()
  for (const transport of transports) for (const pair of pairs) transport.revoke(pair)
  peers.clear()
  transports.clear()
  pairs.clear()
})

function manager() {
  const transport = new DeviceTransport()
  transports.add(transport)
  pairs.add(deviceTestFrame.pairId)
  return transport
}

async function peer(
  port: number,
  identity: ReturnType<typeof transportIdentity> = source,
  session?: Buffer,
) {
  const socket = tlsConnect({
    host: '127.0.0.1',
    port,
    ca: [receiver.certificate],
    rejectUnauthorized: true,
    checkServerIdentity: () => undefined,
    minVersion: 'TLSv1.3',
    maxVersion: 'TLSv1.3',
    cert: identity.certificate,
    key: identity.privateKey,
    ...(session !== undefined && { session }),
  })
  peers.add(socket)
  socket.on('error', () => undefined)
  await new Promise<void>((resolve) => {
    socket.once('secureConnect', resolve)
    socket.once('close', resolve)
  })
  return socket
}

async function observedTcpClose(port: number): Promise<number> {
  const socket = tcpConnect({ host: '127.0.0.1', port })
  const started = Date.now()
  socket.on('error', () => undefined)
  try {
    await new Promise<void>((resolve) => socket.once('close', resolve))
    return Date.now() - started
  } finally {
    socket.destroy()
  }
}

describe('pinned device transport with real loopback TLS', () => {
  it.each(
    ['DNS', 'TLS', 'offer', 'decoded-offer', 'readiness', 'listen'].flatMap((transition) =>
      ['wall-forward', 'monotonic', 'wall-backward'].map((clock) => ({ transition, clock })),
    ),
  )(
    'RVM100T-P2-3 refuses delayed $transition on $clock before timer servicing',
    async ({ transition, clock }) => {
      const port = await transportPort()
      const incoming = transportHandler(false)
      const outgoing = transportHandler()
      const server = manager()
      if (transition !== 'listen')
        await server.listen(transportPair(receiver, source), '127.0.0.1', port, incoming)
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const time = transportClock()
      const dialing = vi.spyOn(Socket.prototype, 'connect')
      const idle = vi.spyOn(TLSSocket.prototype, 'setTimeout')
      const expire = () => {
        if (clock === 'monotonic') time.monotonic += DEVICE_LIMITS.handshakeDeadlineMs + 1
        else time.wall += clock === 'wall-forward' ? DEVICE_LIMITS.handshakeDeadlineMs + 1 : -1
      }
      const dns = Promise.withResolvers<readonly string[]>()
      const client = new DeviceTransport({
        interfaces: () => ['127.0.0.1'],
        lookup: () => dns.promise,
      })
      transports.add(client)
      let announcement: DeviceChannel | undefined
      incoming.connected = vi.fn((channel: DeviceChannel) => {
        announcement = channel
        if (
          clock === 'wall-backward' &&
          (transition === 'decoded-offer' || transition === 'readiness')
        )
          time.wall += 2
        if (transition !== 'offer') channel.send(deviceTestFrame)
      })
      switch (transition) {
        case 'TLS': {
          const protocol = TLSSocket.prototype.getProtocol
          vi.spyOn(TLSSocket.prototype, 'getProtocol').mockImplementation(function (
            this: TLSSocket,
          ) {
            const result = protocol.call(this)
            if (this.remotePort === port) expire()
            return result
          })

          break
        }
        case 'decoded-offer': {
          const push = DeviceFrameDecoder.prototype.push
          vi.spyOn(DeviceFrameDecoder.prototype, 'push').mockImplementation(function (
            this: DeviceFrameDecoder,
            chunk,
            available,
          ) {
            const result = push.call(this, chunk, available)
            if (result.length > 0) expire()
            return result
          })

          break
        }
        case 'readiness': {
          outgoing.connected = vi.fn(expire)
          break
        }
        case 'listen': {
          vi.spyOn(Server.prototype, 'listen').mockImplementation(function (this: Server) {
            expire()
            queueMicrotask(() => {
              this.emit('listening')
            })
            return this
          })

          break
        }
        // No default
      }
      const waiting =
        transition === 'listen'
          ? server.listen(transportPair(receiver, source), '127.0.0.1', port, incoming)
          : client.connect(
              transportPair(source, receiver),
              transition === 'DNS' ? 'peer.local' : '127.0.0.1',
              port,
              '127.0.0.1',
              outgoing,
            )
      let failure: string | undefined
      void waiting.catch((error: unknown) => {
        if (error instanceof Error) failure = error.message
      })
      if (transition === 'DNS') {
        expire()
        dns.resolve(['127.0.0.1'])
      } else if (transition === 'offer') {
        await vi.waitFor(() => {
          expect(announcement).toBeDefined()
        })
        expire()
        announcement?.send(deviceTestFrame)
      }
      await vi.waitFor(() => {
        expect(failure).toBe('blocked-or-unreachable')
      })
      await expect(waiting).rejects.toThrow('blocked-or-unreachable')
      expect(outgoing.connected).toHaveBeenCalledTimes(transition === 'readiness' ? 1 : 0)
      expect(outgoing.receive).not.toHaveBeenCalled()
      if (transition === 'DNS' || transition === 'listen')
        expect(incoming.connected).not.toHaveBeenCalled()
      if (transition === 'DNS') expect(dialing).not.toHaveBeenCalled()
      else if (transition === 'TLS')
        expect(
          idle.mock.contexts.some(
            (owner, index) =>
              owner instanceof TLSSocket &&
              owner.remotePort === port &&
              idle.mock.calls[index]?.[0] === DEVICE_LIMITS.idleConnectionMs,
          ),
        ).toBe(false)
    },
  )
  it('RVM100T-P2-3 keeps established channels usable after the setup deadline', async () => {
    const port = await transportPort()
    const incoming = transportHandler()
    const outgoing = transportHandler()
    incoming.receive = vi.fn((_frame: DeviceFrame, channel: DeviceChannel) => {
      channel.send(deviceTestFrame)
      return Promise.resolve()
    })
    await manager().listen(transportPair(receiver, source), '127.0.0.1', port, incoming)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
    const channel = await manager().connect(
      transportPair(source, receiver),
      '127.0.0.1',
      port,
      '127.0.0.1',
      outgoing,
    )
    await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.handshakeDeadlineMs + 1)
    channel.send(deviceTestFrame)
    await vi.waitFor(() => {
      expect(outgoing.receive).toHaveBeenCalledTimes(2)
    })
    expect(outgoing.connected).toHaveBeenCalledTimes(1)
    expect(outgoing.disconnected).not.toHaveBeenCalled()
    channel.close()
  })
  it('RVM100T-P2-1 unlink before bind rejects startup as revoked within its deadline', async () => {
    const server = manager()
    const handler = transportHandler()
    const pair = transportPair(receiver, source)
    const port = await transportPort()
    const started = performance.now()
    const listening = server.listen(pair, '127.0.0.1', port, handler)
    let failure: string | undefined
    void listening.catch((error: unknown) => {
      if (error instanceof Error) failure = error.message
    })
    server.revoke(pair.pairId)
    await vi.waitFor(() => {
      expect(failure).toBe('revoked')
    })
    expect(performance.now() - started).toBeLessThan(DEVICE_LIMITS.handshakeDeadlineMs)
    expect(handler.connected).not.toHaveBeenCalled()
    await server.listen(pair, '127.0.0.1', port, handler)
  })
  it('RVM100T-P2-1 closes pending startup and bounds a bind that emits no completion', async () => {
    const port = await transportPort()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pendingServers: Server[] = []
    vi.spyOn(Server.prototype, 'listen').mockImplementation(function (this: Server) {
      pendingServers.push(this)
      return this
    })
    const server = manager()
    const pair = transportPair(receiver, source)
    for (const shouldClose of [true, false]) {
      const waiting = server.listen(pair, '127.0.0.1', port, transportHandler())
      let failure: string | undefined
      void waiting.catch((error: unknown) => {
        if (error instanceof Error) failure = error.message
      })
      if (shouldClose) pendingServers.at(-1)?.emit('close')
      await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.handshakeDeadlineMs)
      expect(failure).toBe(shouldClose ? 'revoked' : 'blocked-or-unreachable')
    }
  })
  it('RVM100T-P2-2 stale listener cleanup preserves the replacement and its connections', async () => {
    const server = manager()
    const pair = transportPair(receiver, source)
    const port = await transportPort()
    const stopA = await server.listen(pair, '127.0.0.1', port, transportHandler())
    stopA()
    const incoming = transportHandler()
    await server.listen(pair, '127.0.0.1', port, incoming)
    const outgoing = transportHandler()
    const channel = await manager().connect(
      transportPair(source, receiver),
      '127.0.0.1',
      port,
      '127.0.0.1',
      outgoing,
    )
    stopA()
    channel.send(deviceTestFrame)
    await vi.waitFor(() => {
      expect(incoming.receive).toHaveBeenCalledTimes(1)
    })
    expect(outgoing.disconnected).not.toHaveBeenCalled()
    const replacement = await manager().connect(
      transportPair(source, receiver),
      '127.0.0.1',
      port,
      '127.0.0.1',
      transportHandler(),
    )
    replacement.send(deviceTestFrame)
    await vi.waitFor(() => {
      expect(incoming.receive).toHaveBeenCalledTimes(2)
    })
    channel.close()
    replacement.close()
  })
  it('ignores proxy environment variables and forwards no proxy request or credential', async () => {
    const intercepted = vi.fn()
    const proxy = tcpServer((socket) => {
      intercepted()
      socket.destroy()
    })
    const proxyPort = await transportPort()
    await new Promise<void>((resolve) => proxy.listen(proxyPort, '127.0.0.1', resolve))
    for (const variable of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'])
      vi.stubEnv(variable, `http://127.0.0.1:${String(proxyPort)}`)
    vi.stubEnv('NODE_USE_ENV_PROXY', '1')
    const port = await transportPort()
    const handler = transportHandler()
    const server = manager()
    try {
      await server.listen(transportPair(receiver, source), '127.0.0.1', port, handler)
      const channel = await manager().connect(
        transportPair(source, receiver),
        '127.0.0.1',
        port,
        '127.0.0.1',
        transportHandler(),
      )
      channel.send(deviceTestFrame)
      await vi.waitFor(() => {
        expect(handler.receive).toHaveBeenCalledTimes(1)
      })
      expect(intercepted).not.toHaveBeenCalled()
      expect(handler.receive).toHaveBeenCalledWith(deviceTestFrame, expect.anything())
      channel.close()
    } finally {
      await new Promise<void>((resolve) =>
        proxy.close(() => {
          resolve()
        }),
      )
    }
  })
  it('exchanges authenticated versioned frames without discovery or proxy forwarding', async () => {
    const port = await transportPort()
    const client = manager()
    const server = manager()
    const incoming = transportHandler()
    const outgoing = transportHandler()
    await server.listen(transportPair(receiver, source), '127.0.0.1', port, incoming)
    const channel = await client.connect(
      transportPair(source, receiver),
      '127.0.0.1',
      port,
      '127.0.0.1',
      outgoing,
    )
    channel.send(deviceTestFrame)
    await vi.waitFor(() => {
      expect(incoming.receive).toHaveBeenCalledTimes(1)
    })
    expect(incoming.receive).toHaveBeenCalledWith(deviceTestFrame, expect.anything())
    channel.close()
    await vi.waitFor(() => {
      expect(outgoing.disconnected).toHaveBeenCalledTimes(1)
    })
  })
  it('reconnects to current offers while preserving historical attempt ownership for reconciliation', async () => {
    const port = await transportPort()
    const currentIncarnation = 'd'.repeat(32)
    const incoming = transportHandler()
    const outgoing = transportHandler()
    await manager().listen(
      { ...transportPair(receiver, source), receiverIncarnationId: currentIncarnation },
      '127.0.0.1',
      port,
      incoming,
    )
    const channel = await manager().connect(
      transportPair(source, receiver),
      '127.0.0.1',
      port,
      '127.0.0.1',
      outgoing,
    )
    expect(channel.receiverIncarnationId).toBe(currentIncarnation)
    const identity = {
      pairId: deviceTestFrame.pairId,
      receiverIncarnationId: deviceTestFrame.receiverIncarnationId,
      boardId: 'e'.repeat(32),
      taskId: 'f'.repeat(32),
      attemptId: '0'.repeat(32),
    }
    const reconcile: DeviceFrame = {
      ...deviceTestFrame,
      receiverIncarnationId: currentIncarnation,
      body: { kind: 'reconcile', identities: [identity] },
    }
    channel.send(reconcile)
    await vi.waitFor(() => {
      expect(incoming.receive).toHaveBeenCalledWith(reconcile, expect.anything())
    })
    expect(identity.receiverIncarnationId).toBe(deviceTestFrame.receiverIncarnationId)
    expect(outgoing.connected).toHaveBeenCalledTimes(1)
    channel.close()
  })
  it('bounds a pinned peer that completes TLS but never announces its current offers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const port = await transportPort()
    const incoming = transportHandler(false)
    const outgoing = transportHandler()
    await manager().listen(transportPair(receiver, source), '127.0.0.1', port, incoming)
    const connecting = manager().connect(
      transportPair(source, receiver),
      '127.0.0.1',
      port,
      '127.0.0.1',
      outgoing,
    )
    let hasFailed = false
    void connecting.catch(() => {
      hasFailed = true
    })
    await vi.waitFor(() => {
      expect(incoming.connected).toHaveBeenCalledTimes(1)
    })
    expect(outgoing.connected).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.handshakeDeadlineMs)
    expect(hasFailed).toBe(true)
    await expect(connecting).rejects.toThrow('blocked-or-unreachable')
    expect(outgoing.receive).not.toHaveBeenCalled()
  })
  it('T-local-peer-credentials rejects anonymous and wrong-pair clients before application handlers', async () => {
    const port = await transportPort()
    const server = manager()
    const handler = transportHandler()
    await server.listen(transportPair(receiver, source), '127.0.0.1', port, handler)
    const wrong = await peer(port, attacker)
    wrong.write(encodeDeviceFrame(deviceTestFrame))
    wrong.setTimeout(100, () => wrong.destroy())
    if (!wrong.destroyed) await new Promise<void>((resolve) => wrong.once('close', resolve))
    const anonymous = tlsConnect({
      host: '127.0.0.1',
      port,
      ca: receiver.certificate,
      checkServerIdentity: () => undefined,
    })
    peers.add(anonymous)
    anonymous.on('error', () => undefined)
    anonymous.once('secureConnect', () => {
      anonymous.write(encodeDeviceFrame(deviceTestFrame))
    })
    anonymous.setTimeout(100, () => anonymous.destroy())
    await new Promise<void>((resolve) => anonymous.once('close', resolve))
    expect(handler.receive).not.toHaveBeenCalled()
    expect(handler.disconnected).not.toHaveBeenCalled()
    expect(handler.connected).not.toHaveBeenCalled()
  })
  it('rejects a CA-signed child leaf even when TLS chain verification succeeds', async () => {
    const child = transportIdentity(source)
    const verified = Promise.withResolvers<boolean>()
    const control = tlsServer(
      {
        key: receiver.privateKey,
        cert: receiver.certificate,
        ca: source.certificate,
        requestCert: true,
        rejectUnauthorized: true,
      },
      (socket) => {
        peers.add(socket)
        verified.resolve(socket.authorized)
        socket.end()
      },
    )
    const controlPort = await transportPort()
    await new Promise<void>((resolve) => control.listen(controlPort, '127.0.0.1', resolve))
    try {
      const allowed = await peer(controlPort, child)
      expect(await verified.promise).toBe(true)
      allowed.destroy()
    } finally {
      await new Promise<void>((resolve) =>
        control.close(() => {
          resolve()
        }),
      )
    }
    const port = await transportPort()
    const server = manager()
    const handler = transportHandler()
    await server.listen(transportPair(receiver, source), '127.0.0.1', port, handler)
    const socket = await peer(port, child)
    socket.write(encodeDeviceFrame(deviceTestFrame))
    socket.setTimeout(100, () => socket.destroy())
    await new Promise<void>((resolve) => {
      if (socket.destroyed) resolve()
      else socket.once('close', resolve)
    })
    expect(handler.receive).not.toHaveBeenCalled()
    expect(handler.disconnected).not.toHaveBeenCalled()
    expect(handler.connected).not.toHaveBeenCalled()
  })
  it('refuses changed pins, missing offer, unknown interface, wildcard and protocol downgrade', async () => {
    const server = manager()
    const handler = transportHandler()
    const port = await transportPort()
    const pair = transportPair(receiver, source)
    await expect(
      server.listen({ ...pair, peerFingerprint: attacker.fingerprint }, '127.0.0.1', port, handler),
    ).rejects.toThrow('unpaired')
    await expect(
      server.listen({ ...pair, isOffered: () => false }, '127.0.0.1', port, handler),
    ).rejects.toThrow('unpaired')
    await expect(server.listen(pair, '0.0.0.0', port, handler)).rejects.toThrow()
    await expect(server.listen(pair, '10.250.0.200', port, handler)).rejects.toThrow()
    await server.listen(pair, '127.0.0.1', port, handler)
    const old = tlsConnect({
      host: '127.0.0.1',
      port,
      key: source.privateKey,
      cert: source.certificate,
      ca: receiver.certificate,
      checkServerIdentity: () => undefined,
      maxVersion: 'TLSv1.2',
    })
    peers.add(old)
    old.on('error', () => undefined)
    old.once('secureConnect', () => {
      old.write(encodeDeviceFrame(deviceTestFrame))
    })
    old.setTimeout(100, () => old.destroy())
    await new Promise<void>((resolve) => old.once('close', resolve))
    expect(handler.receive).not.toHaveBeenCalled()
  })
  it('refuses corrupt identity material with fixed errors before enabling a listener', async () => {
    const pair = transportPair(receiver, source)
    const child = transportIdentity(source)
    const server = manager()
    const port = await transportPort()
    for (const invalid of [
      { ...pair, privateKey: 'synthetic-corrupt-material' },
      { ...pair, privateKey: attacker.privateKey },
      { ...pair, peerCertificate: child.certificate, peerFingerprint: child.fingerprint },
      {
        ...pair,
        peerCertificate: pair.peerCertificate + ' '.repeat(DEVICE_LIMITS.invitationTextChars),
      },
    ]) {
      await expect(server.listen(invalid, '127.0.0.1', port, transportHandler())).rejects.toThrow(
        'unpaired',
      )
    }
  })
  it('bounds pair listeners and refuses duplicate listener takeover', async () => {
    const server = manager()
    const handler = transportHandler()
    for (let index = 0; index < DEVICE_LIMITS.pairedDevices; index += 1) {
      const pairId = index.toString(16).padStart(32, '0')
      pairs.add(pairId)
      await server.listen(
        { ...transportPair(receiver, source), pairId },
        '127.0.0.1',
        await transportPort(),
        handler,
      )
      if (index === 0)
        await expect(
          server.listen(
            { ...transportPair(receiver, source), pairId },
            '127.0.0.1',
            await transportPort(),
            handler,
          ),
        ).rejects.toThrow('unpaired')
    }
    const overflow = { ...transportPair(receiver, source), pairId: 'd'.repeat(32) }
    pairs.add(overflow.pairId)
    await expect(
      server.listen(overflow, '127.0.0.1', await transportPort(), handler),
    ).rejects.toThrow('unpaired')
    await expect(
      server.listen(
        { ...overflow, pairId: '0'.repeat(32) },
        '127.0.0.1',
        await transportPort(),
        handler,
      ),
    ).rejects.toThrow('unpaired')
  })
  it('rechecks revocation on an existing socket before another request', async () => {
    const server = manager()
    const client = manager()
    const port = await transportPort()
    const handler = transportHandler()
    const disconnected = transportHandler()
    let isActive = true
    await server.listen(
      { ...transportPair(receiver, source), isActive: () => isActive },
      '127.0.0.1',
      port,
      handler,
    )
    const channel = await client.connect(
      transportPair(source, receiver),
      '127.0.0.1',
      port,
      '127.0.0.1',
      disconnected,
    )
    channel.send(deviceTestFrame)
    await vi.waitFor(() => {
      expect(handler.receive).toHaveBeenCalledTimes(1)
    })
    isActive = false
    channel.send(deviceTestFrame)
    await vi.waitFor(() => {
      expect(disconnected.disconnected).toHaveBeenCalledTimes(1)
    })
    expect(handler.receive).toHaveBeenCalledTimes(1)
  })
  it('unlink closes only its own listener and live connections', async () => {
    const server = manager()
    const client = manager()
    const otherId = 'd'.repeat(32)
    pairs.add(otherId)
    const firstPort = await transportPort()
    const secondPort = await transportPort()
    const first = transportHandler()
    const second = transportHandler()
    const received = transportHandler()
    await server.listen(transportPair(receiver, source), '127.0.0.1', firstPort, transportHandler())
    await server.listen(
      { ...transportPair(attacker, receiver), pairId: otherId },
      '127.0.0.1',
      secondPort,
      received,
    )
    await client.connect(
      transportPair(source, receiver),
      '127.0.0.1',
      firstPort,
      '127.0.0.1',
      first,
    )
    const other = await client.connect(
      { ...transportPair(receiver, attacker), pairId: otherId },
      '127.0.0.1',
      secondPort,
      '127.0.0.1',
      second,
    )
    server.revoke(deviceTestFrame.pairId)
    await vi.waitFor(() => {
      expect(first.disconnected).toHaveBeenCalledTimes(1)
    })
    other.send({ ...deviceTestFrame, pairId: otherId })
    await vi.waitFor(() => {
      expect(received.receive).toHaveBeenCalledTimes(1)
    })
    expect(second.disconnected).not.toHaveBeenCalled()
    other.close()
  })
  it('refuses real captured TLS tickets and authenticates each connection again', async () => {
    const controlSockets = new Set<TLSSocket>()
    const controlPort = await transportPort()
    const control = tlsServer(
      {
        key: receiver.privateKey,
        cert: receiver.certificate,
        ca: source.certificate,
        requestCert: true,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.3',
        maxVersion: 'TLSv1.3',
      },
      (socket) => {
        controlSockets.add(socket)
      },
    )
    await new Promise<void>((resolve) => control.listen(controlPort, '127.0.0.1', resolve))
    try {
      const initial = await peer(controlPort)
      const realTicket = await new Promise<Buffer>((resolve) => initial.once('session', resolve))
      initial.destroy()
      await new Promise<void>((resolve) => initial.once('close', resolve))
      const resumed = await peer(controlPort, source, realTicket)
      expect(resumed.isSessionReused()).toBe(true)
      resumed.destroy()
    } finally {
      for (const socket of controlSockets) socket.destroy()
      await new Promise<void>((resolve) =>
        control.close(() => {
          resolve()
        }),
      )
    }
    const server = manager()
    const port = await transportPort()
    const handler = transportHandler()
    await server.listen(transportPair(receiver, source), '127.0.0.1', port, handler)
    const first = await peer(port)
    const ticket = await new Promise<Buffer>((resolve) => first.once('session', resolve))
    expect(ticket.length).toBeGreaterThan(0)
    first.destroy()
    await new Promise<void>((resolve) => first.once('close', resolve))
    const second = await peer(port, source, ticket)
    expect(second.isSessionReused()).toBe(false)
    second.write(encodeDeviceFrame(deviceTestFrame))
    await vi.waitFor(() => {
      expect(handler.receive).toHaveBeenCalledTimes(1)
    })
    second.destroy()
  })
  it('bounds unauthenticated connections and releases transport slots on socket close', async () => {
    const server = manager()
    const port = await transportPort()
    const handler = transportHandler()
    await server.listen(transportPair(receiver, source), '127.0.0.1', port, handler)
    const stalled = Array.from({ length: DEVICE_LIMITS.connectionsPerPair }, () =>
      tcpConnect({ host: '127.0.0.1', port }),
    )
    try {
      await Promise.all(
        stalled.map((socket) => new Promise<void>((resolve) => socket.once('connect', resolve))),
      )
      expect(await observedTcpClose(port)).toBeLessThan(DEVICE_LIMITS.handshakeDeadlineMs / 2)
      expect(handler.receive).not.toHaveBeenCalled()
    } finally {
      for (const socket of stalled) socket.destroy()
    }
    await vi.waitFor(async () => {
      const channel = await manager().connect(
        transportPair(source, receiver),
        '127.0.0.1',
        port,
        '127.0.0.1',
        transportHandler(),
      )
      channel.close()
    })
  })
  it('bounds all pairs together before unauthenticated traffic can exhaust the window', async () => {
    const server = manager()
    const stalled: ReturnType<typeof tcpConnect>[] = []
    const handler = transportHandler()
    try {
      for (
        let count = 0;
        count < DEVICE_LIMITS.connectionsTotal / DEVICE_LIMITS.connectionsPerPair;
        count += 1
      ) {
        const pairId = count.toString(16).padStart(32, '0')
        pairs.add(pairId)
        const port = await transportPort()
        await server.listen(
          { ...transportPair(receiver, source), pairId },
          '127.0.0.1',
          port,
          handler,
        )
        for (let index = 0; index < DEVICE_LIMITS.connectionsPerPair; index += 1) {
          const socket = tcpConnect({ host: '127.0.0.1', port })
          stalled.push(socket)
          await new Promise<void>((resolve) => socket.once('connect', resolve))
        }
      }
      const pairId = 'd'.repeat(32)
      pairs.add(pairId)
      const port = await transportPort()
      await server.listen(
        { ...transportPair(receiver, source), pairId },
        '127.0.0.1',
        port,
        handler,
      )
      expect(await observedTcpClose(port)).toBeLessThan(DEVICE_LIMITS.handshakeDeadlineMs / 2)
      expect(handler.receive).not.toHaveBeenCalled()
    } finally {
      for (const socket of stalled) socket.destroy()
    }
  })
  it('times out a real stalled handshake and never installs an application handler', async () => {
    const server = manager()
    const port = await transportPort()
    const handler = transportHandler()
    await server.listen(transportPair(receiver, source), '127.0.0.1', port, handler)
    const socket = tcpConnect({ host: '127.0.0.1', port })
    socket.on('error', () => undefined)
    const startedAt = Date.now()
    try {
      await new Promise<void>((resolve) => socket.once('close', resolve))
      expect(Date.now() - startedAt).toBeLessThan(
        DEVICE_LIMITS.handshakeDeadlineMs + DEVICE_LIMITS.handshakeDeadlineMs / 2,
      )
      expect(handler.receive).not.toHaveBeenCalled()
      expect(handler.disconnected).not.toHaveBeenCalled()
    } finally {
      socket.destroy()
    }
  })
  it('rejects a CA-signed server child despite a valid chain and checks its exact saved pin', async () => {
    const child = transportIdentity(receiver)
    const accepted = new Set<TLSSocket>()
    const server = tlsServer(
      {
        key: child.privateKey,
        cert: child.certificate,
        ca: source.certificate,
        requestCert: true,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.3',
        maxVersion: 'TLSv1.3',
      },
      (socket) => {
        accepted.add(socket)
        socket.write(encodeDeviceFrame(deviceTestFrame))
      },
    )
    server.on('tlsClientError', () => undefined)
    const port = await transportPort()
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
    const handler = transportHandler()
    try {
      const connecting = manager().connect(
        transportPair(source, receiver),
        '127.0.0.1',
        port,
        '127.0.0.1',
        handler,
      )
      void connecting
        .then((channel) => {
          channel.close()
        })
        .catch(() => undefined)
      await expect(connecting).rejects.toThrow('blocked-or-unreachable')
      expect(handler.receive).not.toHaveBeenCalled()
    } finally {
      for (const socket of accepted) socket.destroy()
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve()
        }),
      )
    }
  })
  it('bounds stalled DNS and cancels pending connection setup on unlink without late dialing', async () => {
    const port = await transportPort()
    const receiverHandler = transportHandler()
    await manager().listen(transportPair(receiver, source), '127.0.0.1', port, receiverHandler)
    vi.useFakeTimers()
    const dns = Promise.withResolvers<readonly string[]>()
    const lookup = vi.fn(() => dns.promise)
    const transport = new DeviceTransport({ interfaces: () => ['127.0.0.1'], lookup })
    transports.add(transport)
    const handler = transportHandler()
    const pair = transportPair(source, receiver)
    for (let attempt = 0; attempt <= DEVICE_LIMITS.connectionsPerPair; attempt += 1) {
      const waiting = transport.connect(pair, 'peer.local', port, '127.0.0.1', handler)
      let hasTimedOut = false
      void waiting.catch(() => {
        hasTimedOut = true
      })
      await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.handshakeDeadlineMs)
      expect(hasTimedOut).toBe(true)
      await expect(waiting).rejects.toThrow('blocked-or-unreachable')
    }
    const connecting = transport.connect(pair, 'peer.local', port, '127.0.0.1', handler)
    let isCancelled = false
    void connecting.catch(() => {
      isCancelled = true
    })
    transport.revoke(pair.pairId)
    await vi.advanceTimersByTimeAsync(0)
    expect(isCancelled).toBe(true)
    await expect(connecting).rejects.toThrow('blocked-or-unreachable')
    vi.useRealTimers()
    dns.resolve(['127.0.0.1'])
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
    expect(receiverHandler.connected).not.toHaveBeenCalled()
    expect(handler.connected).not.toHaveBeenCalled()
    expect(handler.receive).not.toHaveBeenCalled()
    expect(handler.disconnected).not.toHaveBeenCalled()
  })
  it('reports blocked or unreachable on denied/unrouted retry without settling ownership', async () => {
    const port = await transportPort()
    const handler = transportHandler()
    const client = manager()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        client.connect(transportPair(source, receiver), '127.0.0.1', port, '127.0.0.1', handler),
      ).rejects.toThrow('blocked-or-unreachable')
    }
    expect(handler.receive).not.toHaveBeenCalled()
    expect(handler.disconnected).not.toHaveBeenCalled()
  })
  it('performs absolutely no I/O during construction and rechecks DNS on reconnect', async () => {
    const lookup = vi.fn(() => Promise.resolve(['127.0.0.1']))
    const interfaces = vi.fn(() => ['127.0.0.1'])
    const client = new DeviceTransport({ lookup, interfaces })
    transports.add(client)
    expect(lookup).not.toHaveBeenCalled()
    expect(interfaces).not.toHaveBeenCalled()
    const port = await transportPort()
    const server = manager()
    await server.listen(transportPair(receiver, source), '127.0.0.1', port, transportHandler())
    const pair: DeviceTransportPair = transportPair(source, receiver)
    const channel = await client.connect(pair, 'peer.local', port, '127.0.0.1', transportHandler())
    channel.close()
    lookup.mockResolvedValue(['169.254.169.254'])
    await expect(
      client.connect(pair, 'peer.local', port, '127.0.0.1', transportHandler()),
    ).rejects.toThrow('blocked-or-unreachable')
    expect(lookup).toHaveBeenCalledTimes(2)
  })
})
