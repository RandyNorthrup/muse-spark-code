import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { handshakeBackoffMs, type DeviceThrottled } from '../../src/shared/devices'
import {
  MultiplexedDeviceChannel,
  type MultiplexedDeviceMessage,
} from '../../src/core/devices/channel'
import {
  DeviceChannelDialFailure,
  PacedDeviceChannels,
  type DeviceChannelDialer,
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
  transferChannel,
} from './helpers/multiplexedChannelFixtures'
import { deviceTestFrame } from './helpers/deviceTransportFixtures'
import { deviceCheck, deviceGrant } from './helpers/deviceFixtures'

const pools = new Set<PacedDeviceChannels>()
afterEach(() => {
  for (const pool of pools) pool.close()
  pools.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function cores() {
  return {
    source: new MultiplexedDeviceChannel(channelReady),
    target: new MultiplexedDeviceChannel(channelReady),
  }
}
function pacer(dialer: DeviceChannelDialer, randomSource = () => 0) {
  const pacing = {
    throttled: vi.fn<(state: DeviceThrottled) => void>(),
    authenticationRequired: vi.fn<(pairId: string) => void>(),
  }
  const pool = new PacedDeviceChannels(dialer, pacing, randomSource)
  pools.add(pool)
  return { pool, pacing }
}
function pacingClock() {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'],
  })
}
function tick() {
  return new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
}

describe('multiplexed portable channel', () => {
  it('validates and delivers every lane-0 envelope on its assigned stream', () => {
    const request = channelGrantRequest()
    const grant = deviceGrant(channelReady.pairId)
    const dispatch = deviceCheck({
      ...grant,
      offer: { ...grant.offer, receiverIncarnationId: channelReady.receiverIncarnationId },
    })
    const result = {
      version: 1 as const,
      identity: dispatch.identity,
      epoch: 1,
      checkpoint: 'f'.repeat(64),
      resultDigest: '0'.repeat(64),
      resultBytes: 100,
      recordedAt: 1000,
    }
    const messages: MultiplexedDeviceMessage[] = [
      { kind: 'ready', ready: channelReady },
      {
        kind: 'heartbeat',
        heartbeat: {
          version: 1,
          pairId: channelReady.pairId,
          receiverIncarnationId: channelReady.receiverIncarnationId,
          sequence: 1,
          ackSequence: 0,
        },
      },
      {
        kind: 'throttled',
        throttled: {
          version: 1,
          pairId: channelReady.pairId,
          unknownSince: 1000,
          reason: 'peer-penalty',
        },
      },
      {
        kind: 'capability',
        capability: {
          version: 1,
          deviceId: 'c'.repeat(32),
          receiverIncarnationId: channelReady.receiverIncarnationId,
          observedAt: 1000,
          platform: 'linux',
          osVersion: 'test Linux',
          tools: ['node'],
          engines: [],
          presence: { touchId: false, windowsHello: false, tpm: false, secureEnclave: false },
          power: 'ac',
          sleepInhibited: false,
          slotCap: 1,
          pressure: { cpuPercent: 0, memoryPercent: 0, diskPercent: 0, transportResets: 0 },
        },
      },
      { kind: 'grantRequest', request },
      {
        kind: 'grant',
        grant: {
          ...request,
          grantId: 'f'.repeat(32),
          grantRevision: 1,
          issuedAt: 1000,
          expiresAt: 2000,
          requiresStepUp: false,
        },
      },
      {
        kind: 'grantRefusal',
        refusal: {
          version: 1,
          pairId: channelReady.pairId,
          ownerId: request.ownerId,
          reason: 'scope-denied',
          retryable: false,
        },
      },
      { kind: 'result', result },
      {
        kind: 'resultAck',
        ack: {
          version: 1,
          identity: dispatch.identity,
          epoch: 1,
          resultDigest: result.resultDigest,
          settlementId: 'e'.repeat(32),
          disposition: 'accepted',
          acknowledgedAt: 2000,
        },
      },
      { kind: 'frame', frame: { ...deviceTestFrame, body: { kind: 'dispatch', dispatch } } },
      {
        kind: 'frame',
        frame: {
          ...deviceTestFrame,
          body: {
            kind: 'checkReport',
            identity: dispatch.identity,
            repositoryId: dispatch.repositoryId,
            tree: dispatch.snapshot.tree,
            checkId: 'c'.repeat(32),
            toolchainDigest: 'd'.repeat(64),
            status: 'passed',
            report: 'fake report',
          },
        },
      },
    ]
    const { source, target } = cores()
    for (const message of messages) expect(source.enqueue(message)).toBe(true)
    transferChannel(source, target)
    const received: MultiplexedDeviceMessage[] = []
    for (const isControl of [true, false]) {
      let delivery = target.takeIncoming(isControl)
      while (delivery !== undefined) {
        received.push(delivery.message)
        target.complete(delivery)
        delivery = target.takeIncoming(isControl)
      }
    }
    expect(received).toHaveLength(messages.length)
    expect(received).toEqual(expect.arrayContaining(messages))
    const bad = structuredClone(messages[0])
    if (bad?.kind !== 'ready') throw new Error('fixture')
    bad.ready.streams[1] = 'control'
    expect(() => source.enqueue(bad)).toThrow('invalid-frame')
    expect(() =>
      source.enqueue({ kind: 'log', text: 'x'.repeat(DEVICE_LIMITS.frameBytes) }),
    ).toThrow('invalid-frame')
  })
  it('preempts fragmented bulk with Stop and prioritizes status/events over logs over bulk', () => {
    const { source, target } = cores()
    source.enqueue(bulkMessage)
    target.push(source.nextPacket()!)
    expect(target.takeIncoming(false)).toBeUndefined()
    source.enqueue({ kind: 'log', text: 'bounded test log' })
    source.enqueue({ kind: 'frame', frame: deviceTestFrame })
    source.enqueue(stopMessage)
    const packets = transferChannel(source, target)
    const streams = packets.map((packet) => channelPacket(packet)['stream'])
    expect(streams[0]).toBe('control')
    expect(streams[1]).toBe('status')
    expect(streams[2]).toBe('logs')
    expect(streams.slice(3).every((stream) => stream === 'bulk')).toBe(true)
    expect(packets.every((packet) => packet.byteLength <= DEVICE_LIMITS.channelFrameBytes)).toBe(
      true,
    )
    const stop = target.takeIncoming(true)!
    expect(stop.message).toEqual(stopMessage)
    target.complete(stop)
    const status = target.takeIncoming(false)!
    expect(status.stream).toBe('status')
    target.complete(status)
    const log = target.takeIncoming(false)!
    expect(log.stream).toBe('logs')
    target.complete(log)
    const bulk = target.takeIncoming(false)!
    expect(bulk.message).toEqual(bulkMessage)
  })
  it('reserves control capacity when all data slots are queued and unacknowledged', () => {
    const { source, target } = cores()
    for (let index = 0; index < DEVICE_LIMITS.queuedFrames; index += 1)
      expect(source.enqueue({ kind: 'log', text: 'queued' })).toBe(true)
    expect(source.enqueue(bulkMessage)).toBe(false)
    expect(source.enqueue(stopMessage)).toBe(true)
    transferChannel(source, target)
    expect(source.enqueue({ kind: 'log', text: 'still unacknowledged' })).toBe(false)
    expect(target.takeIncoming(true)?.message).toEqual(stopMessage)
    const log = target.takeIncoming(false)!
    expect(target.nextPacket()).toBeUndefined()
    target.complete(log)
    transferChannel(target, source)
    expect(source.enqueue({ kind: 'log', text: 'one slot released' })).toBe(true)
    expect(source.enqueue({ kind: 'log', text: 'full again' })).toBe(false)
  })
  it('caps control, receive queues, and running handlers independently', () => {
    const { source, target } = cores()
    for (let index = 0; index < DEVICE_LIMITS.controlFrames; index += 1)
      expect(source.enqueue(stopMessage)).toBe(true)
    expect(source.enqueue(stopMessage)).toBe(false)
    transferChannel(source, target)
    expect(target.takeIncoming(true)).toBeDefined()
    expect(target.takeIncoming(true)).toBeUndefined()
    const over = new MultiplexedDeviceChannel(channelReady)
    over.enqueue(stopMessage)
    const text = new TextDecoder().decode(over.nextPacket())
    const input: Record<string, unknown> = JSON.parse(text)
    const changed = { ...input, sequence: DEVICE_LIMITS.controlFrames + 1 }
    expect(() => {
      target.push(new TextEncoder().encode(JSON.stringify(changed) + '\n'))
    }).toThrow('capacity')
  })
  it('rejects forged acknowledgements, sequence gaps, replay, and wrong fragment order', () => {
    const { source, target } = cores()
    source.enqueue(bulkMessage)
    const first = source.nextPacket()!
    const packet: Record<string, unknown> = JSON.parse(new TextDecoder().decode(first))
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value) + '\n')
    expect(() => {
      source.push(
        encode({
          version: 1,
          pairId: channelReady.pairId,
          receiverIncarnationId: channelReady.receiverIncarnationId,
          stream: 'bulk',
          sequence: 1,
          kind: 'ack',
        }),
      )
    }).toThrow('invalid-frame')
    expect(() => {
      target.push(encode({ ...packet, sequence: 2 }))
    }).toThrow('capacity')
    target.push(first)
    expect(() => {
      target.push(first)
    }).toThrow('invalid-frame')
    expect(() => {
      target.push(encode({ ...packet, part: 2 }))
    }).toThrow('invalid-frame')
  })
  it('accepts duplicate cumulative acknowledgements without releasing another slot', () => {
    const { source, target } = cores()
    source.enqueue({ kind: 'log', text: 'first' })
    source.enqueue({ kind: 'log', text: 'second' })
    transferChannel(source, target)
    const delivery = target.takeIncoming(false)!
    target.complete(delivery)
    expect(() => {
      target.complete(delivery)
    }).toThrow('invalid-frame')
    const ack = target.nextPacket()!
    source.push(ack)
    source.push(ack)
    const second = target.takeIncoming(false)!
    expect(second.sequence).toBe(2)
  })
  it('reassembles UTF-8 and escaped text across every packet boundary', () => {
    const { source, target } = cores()
    const message = { kind: 'log' as const, text: '\\"\n你🙂'.repeat(1800) }
    source.enqueue(message)
    let packet = source.nextPacket()
    while (packet !== undefined) {
      for (const byte of packet) target.push(Uint8Array.of(byte))
      packet = source.nextPacket()
    }
    expect(target.incomplete).toBe(false)
    expect(target.takeIncoming(false)?.message).toEqual(message)
  })
  it('rejects oversized bytes, excessive fragments, invalid UTF-8, duplicate keys, unknown fields and downgrade before delivery', () => {
    const { source } = cores()
    source.enqueue(stopMessage)
    const bytes = source.nextPacket()!
    const text = new TextDecoder().decode(bytes)
    const cases = [
      new Uint8Array(DEVICE_LIMITS.channelFrameBytes),
      Uint8Array.of(255, 10),
      new TextEncoder().encode(text.replace('"version":1', '"version":0')),
      new TextEncoder().encode(text.replace('"version":1', '"version":1,"version":1')),
      new TextEncoder().encode(text.replace('"version":1', '"version":1,"extra":true')),
    ]
    for (const malformed of cases) {
      const target = new MultiplexedDeviceChannel(channelReady)
      expect(() => {
        target.push(malformed)
      }).toThrow()
      expect(target.takeIncoming(true)).toBeUndefined()
    }
  })
  it('binds every packet and inner envelope to the pair/incarnation and prevents control demotion', () => {
    const { source } = cores()
    source.enqueue(stopMessage)
    const packet: Record<string, unknown> = JSON.parse(
      new TextDecoder().decode(source.nextPacket()),
    )
    for (const change of [
      { pairId: '0'.repeat(32) },
      { receiverIncarnationId: '0'.repeat(32) },
      { stream: 'bulk' },
    ]) {
      const target = new MultiplexedDeviceChannel(channelReady)
      expect(() => {
        target.push(new TextEncoder().encode(JSON.stringify({ ...packet, ...change }) + '\n'))
      }).toThrow('invalid-frame')
    }
    expect(() =>
      source.enqueue({ kind: 'frame', frame: { ...deviceTestFrame, pairId: '0'.repeat(32) } }),
    ).toThrow('invalid-frame')
    expect(() => new MultiplexedDeviceChannel({ ...channelReady, streams: ['control'] })).toThrow(
      'invalid-frame',
    )
    source.close()
    expect(() => source.enqueue(stopMessage)).toThrow('revoked')
  })
  it('rejects result and result-ack envelopes naming a different incarnation', () => {
    const { source, target } = cores()
    const foreign = {
      pairId: channelReady.pairId,
      receiverIncarnationId: '9'.repeat(32),
      boardId: 'd'.repeat(32),
      taskId: 'e'.repeat(32),
      attemptId: 'f'.repeat(32),
    }
    const result = {
      version: 1 as const,
      identity: foreign,
      epoch: 1,
      checkpoint: 'f'.repeat(64),
      resultDigest: '0'.repeat(64),
      resultBytes: 100,
      recordedAt: 1000,
    }
    expect(() => source.enqueue({ kind: 'result', result })).toThrow('invalid-frame')
    expect(() =>
      source.enqueue({
        kind: 'resultAck',
        ack: {
          version: 1,
          identity: foreign,
          epoch: 1,
          resultDigest: result.resultDigest,
          settlementId: 'e'.repeat(32),
          disposition: 'accepted',
          acknowledgedAt: 2000,
        },
      }),
    ).toThrow('invalid-frame')
    expect(target.takeIncoming(false)).toBeUndefined()
    const own = { ...foreign, receiverIncarnationId: channelReady.receiverIncarnationId }
    expect(source.enqueue({ kind: 'result', result: { ...result, identity: own } })).toBe(true)
    expect(
      source.enqueue({
        kind: 'resultAck',
        ack: {
          version: 1,
          identity: own,
          epoch: 1,
          resultDigest: result.resultDigest,
          settlementId: 'e'.repeat(32),
          disposition: 'accepted',
          acknowledgedAt: 2000,
        },
      }),
    ).toBe(true)
  })
})

it('rejects duplicate inner keys and caps assembly bytes before parsing', () => {
  const { source, target } = cores()
  source.enqueue(stopMessage)
  const packet = channelPacket(source.nextPacket()!)
  if (typeof packet['text'] !== 'string') throw new Error('fixture text')
  packet['text'] = packet['text'].replace('"kind":"frame"', '"kind":"frame","kind":"frame"')
  expect(() => {
    target.push(new TextEncoder().encode(JSON.stringify(packet) + '\n'))
  }).toThrow('invalid-frame')
  const bulk = cores()
  bulk.source.enqueue(bulkMessage)
  const fragment = channelPacket(bulk.source.nextPacket()!)
  let index = 0
  expect(() => {
    for (;;) {
      bulk.target.push(
        new TextEncoder().encode(JSON.stringify({ ...fragment, part: index, final: false }) + '\n'),
      )
      index += 1
    }
  }).toThrow('invalid-frame')
  expect(index).toBeLessThan(DEVICE_LIMITS.frameFragments - 1)
  expect(bulk.target.takeIncoming(false)).toBeUndefined()
})

describe('host handshake pacing G50 and G52', () => {
  it('refuses a ready promise whose connected callback closed the channel before publication', async () => {
    pacingClock()
    const fixture = fakeChannelSocket()
    const { pool, pacing } = pacer({ dial: () => Promise.resolve(fixture.socket) })
    const port = channelPort()
    port.connected = (channel) => {
      channel.close()
    }
    const result = settleChannel(pool.connect(channelPeer(), channelReady, port))
    await tick()
    expect(fixture.socket.destroyed).toBe(true)
    expect(pacing.throttled).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'handshake-backoff' }),
    )
    pool.close()
    await result
  })
  it('paces inbound and outbound handshake factories together and rejects a duplicate incoming pair', async () => {
    pacingClock()
    const waits = Array.from({ length: 4 }, () => Promise.withResolvers<never>())
    const dial = vi.fn<DeviceChannelDialer['dial']>(() => waits[0]!.promise)
    const { pool, pacing } = pacer({ dial })
    const incoming = waits.slice(1).map((wait) => vi.fn(() => wait.promise))
    const requests = [settleChannel(pool.connect(channelPeer(), channelReady, channelPort()))]
    for (const [index, handshake] of incoming.entries()) {
      const peer = channelPeer(String(index).repeat(32))
      requests.push(
        settleChannel(
          pool.accept(peer, { ...channelReady, pairId: peer.pairId }, channelPort(), handshake),
        ),
      )
    }
    expect(dial).toHaveBeenCalledOnce()
    expect(incoming[0]).toHaveBeenCalledOnce()
    expect(incoming[1]).toHaveBeenCalledOnce()
    expect(incoming[2]).not.toHaveBeenCalled()
    expect(pacing.throttled).toHaveBeenCalledWith(expect.objectContaining({ reason: 'pressure' }))
    const duplicate = vi.fn(() => waits[0]!.promise)
    await expect(
      pool.accept(channelPeer(), channelReady, channelPort(), duplicate),
    ).rejects.toThrow('capacity')
    expect(duplicate).not.toHaveBeenCalled()
    waits[1]!.reject(new DeviceChannelDialFailure('transport'))
    await tick()
    expect(incoming[2]).toHaveBeenCalledOnce()
    expect(incoming[0]).toHaveBeenCalledOnce()
    pool.close()
    for (const wait of waits) wait.reject(new DeviceChannelDialFailure('transport'))
    await Promise.all(requests)
  })
  it('accepts a ready inbound channel, shares it with local callers, and paces a fresh handshake after failure', async () => {
    pacingClock()
    const fixture = fakeChannelSocket(channelReady, false)
    const dial = vi.fn<DeviceChannelDialer['dial']>(() =>
      Promise.reject(new DeviceChannelDialFailure('transport')),
    )
    const { pool } = pacer({ dial })
    const accepted = pool.accept(channelPeer(), channelReady, channelPort(), () =>
      Promise.resolve(fixture.socket),
    )
    await tick()
    fixture.remote.enqueue({ kind: 'ready', ready: channelReady })
    fixture.flush()
    const channel = await accepted
    expect(await pool.connect(channelPeer(), channelReady, channelPort())).toBe(channel)
    expect(dial).not.toHaveBeenCalled()
    channel.close()
    const failedHandshake = vi.fn(() => Promise.reject(new DeviceChannelDialFailure('transport')))
    const failed = settleChannel(
      pool.accept(channelPeer(), channelReady, channelPort(), failedHandshake),
    )
    expect(failedHandshake).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.handshakeBackoffBaseMs)
    await failed
    expect(failedHandshake).toHaveBeenCalledOnce()
    const replacement = fakeChannelSocket(channelReady, false)
    const handshake = vi.fn(() => Promise.resolve(replacement.socket))
    const next = pool.accept(channelPeer(), channelReady, channelPort(), handshake)
    await vi.advanceTimersByTimeAsync(handshakeBackoffMs(2, () => 0) - 1)
    expect(handshake).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    replacement.remote.enqueue({ kind: 'ready', ready: channelReady })
    replacement.flush()
    expect(await next).not.toBe(channel)
  })
  it('memoizes a pair while callers race to open independently dialed TLS sockets', async () => {
    const fixtures: ReturnType<typeof fakeChannelSocket>[] = []
    const dial = vi.fn<DeviceChannelDialer['dial']>(() => {
      const fixture = fakeChannelSocket()
      fixtures.push(fixture)
      return Promise.resolve(fixture.socket)
    })
    const { pool } = pacer({ dial })
    try {
      const requests = [
        pool.connect(channelPeer(), channelReady, channelPort()),
        pool.connect(channelPeer(), channelReady, channelPort()),
      ]
      const [first, second] = await Promise.all(requests)
      expect(dial).toHaveBeenCalledOnce()
      expect(first).toBe(second)
    } finally {
      for (const fixture of fixtures) fixture.socket.destroy()
    }
  })
  it('binds a restarted receiver incarnation only after the old channel closes and retains backoff', async () => {
    pacingClock()
    const restarted = { ...channelReady, receiverIncarnationId: '9'.repeat(32) }
    let ready = channelReady
    const dial = vi.fn<DeviceChannelDialer['dial']>(() =>
      Promise.resolve(fakeChannelSocket(ready).socket),
    )
    const { pool, pacing } = pacer({ dial })
    const original = await pool.connect(channelPeer(), channelReady, channelPort())
    await expect(pool.connect(channelPeer(), restarted, channelPort())).rejects.toThrow('unknown')
    expect(original.closed).toBe(false)
    expect(dial).toHaveBeenCalledOnce()
    original.close()
    ready = restarted
    const next = settleChannel(pool.connect(channelPeer(), restarted, channelPort()))
    expect(dial).toHaveBeenCalledOnce()
    expect(pacing.authenticationRequired).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.handshakeBackoffBaseMs - 1)
    expect(dial).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    const channel = await next
    expect(await channel?.ready).toEqual(restarted)
    expect(channel).not.toBe(original)
    expect(dial).toHaveBeenCalledTimes(2)
  })
  it('retains failed inbound backoff when a new incarnation reconnects through an outbound factory', async () => {
    pacingClock()
    const restarted = { ...channelReady, receiverIncarnationId: '9'.repeat(32) }
    const dial = vi.fn<DeviceChannelDialer['dial']>(() =>
      Promise.resolve(fakeChannelSocket(restarted).socket),
    )
    const { pool } = pacer({ dial })
    const incoming = vi.fn(() => Promise.reject(new DeviceChannelDialFailure('transport')))
    await expect(pool.accept(channelPeer(), channelReady, channelPort(), incoming)).rejects.toThrow(
      'unknown',
    )
    const next = settleChannel(pool.connect(channelPeer(), restarted, channelPort()))
    await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.handshakeBackoffBaseMs - 1)
    expect(dial).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    const channel = await next
    expect(await channel?.ready).toEqual(restarted)
    expect(dial).toHaveBeenCalledOnce()
    expect(incoming).toHaveBeenCalledOnce()
  })
  it('lets an unsettled outbound retry adopt a restarted receiver incarnation', async () => {
    pacingClock()
    const restarted = { ...channelReady, receiverIncarnationId: '9'.repeat(32) }
    const dial = vi.fn<DeviceChannelDialer['dial']>(() =>
      Promise.reject(new DeviceChannelDialFailure('transport')),
    )
    const { pool } = pacer({ dial })
    const first = pool.connect(channelPeer(), channelReady, channelPort())
    await tick()
    expect(dial).toHaveBeenCalledOnce()
    dial.mockImplementation(() => Promise.resolve(fakeChannelSocket(restarted).socket))
    const second = pool.connect(channelPeer(), restarted, channelPort())
    expect(second).toBe(first)
    await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.handshakeBackoffBaseMs)
    const channel = await second
    expect(await channel.ready).toEqual(restarted)
    expect(dial).toHaveBeenCalledTimes(2)
  })
  it('queues a handshake burst past pendingHandshakes under backoff', async () => {
    pacingClock()
    const held = Array.from({ length: 5 }, () => Promise.withResolvers<never>())
    const dial = vi
      .fn<DeviceChannelDialer['dial']>()
      .mockImplementation(() => held[dial.mock.calls.length - 1]!.promise)
    const { pool, pacing } = pacer({ dial })
    const requests = Array.from({ length: 5 }, (_, index) => {
      const peer = channelPeer(String(index).repeat(32))
      return settleChannel(
        pool.connect(peer, { ...channelReady, pairId: peer.pairId }, channelPort()),
      )
    })
    expect(dial).toHaveBeenCalledTimes(3)
    expect(pacing.throttled.mock.calls.every(([state]) => state.reason === 'pressure')).toBe(true)
    held[0]!.reject(new DeviceChannelDialFailure('transport'))
    await tick()
    expect(dial).toHaveBeenCalledTimes(4)
    expect(pacing.throttled).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'handshake-backoff', unknownSince: expect.any(Number) }),
    )
    pool.close()
    for (const wait of held.slice(0, dial.mock.calls.length))
      wait.reject(new DeviceChannelDialFailure('transport'))
    await Promise.all(requests)
  })
  it('applies jittered exponential backoff through the ten-minute cap and never calls a port probe', async () => {
    pacingClock()
    const dial = vi.fn<DeviceChannelDialer['dial']>(() =>
      Promise.reject(new DeviceChannelDialFailure('transport')),
    )
    const { pool, pacing } = pacer({ dial }, () => 0.5)
    const request = settleChannel(pool.connect(channelPeer(), channelReady, channelPort()))
    await tick()
    for (let failure = 1; failure <= 8; failure += 1) {
      const delay = handshakeBackoffMs(failure, () => 0.5)
      expect(delay).toBeLessThanOrEqual(600_000)
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(dial).toHaveBeenCalledTimes(failure)
      await vi.advanceTimersByTimeAsync(1)
      expect(dial).toHaveBeenCalledTimes(failure + 1)
    }
    expect(pacing.authenticationRequired).not.toHaveBeenCalled()
    expect(
      pacing.throttled.mock.calls.every(
        ([state]) => !('down' in state) && state.reason === 'handshake-backoff',
      ),
    ).toBe(true)
    pool.close()
    await request
  })
  it('stops after one failed authentication and asks; only explicit consent admits a second attempt', async () => {
    pacingClock()
    const dial = vi.fn<DeviceChannelDialer['dial']>(() =>
      Promise.reject(new DeviceChannelDialFailure('authentication')),
    )
    const { pool, pacing } = pacer({ dial })
    await expect(pool.connect(channelPeer(), channelReady, channelPort())).rejects.toMatchObject({
      reason: 'authentication',
    })
    await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.handshakeBackoffMaxMs * 2)
    await expect(pool.connect(channelPeer(), channelReady, channelPort())).rejects.toMatchObject({
      reason: 'authentication',
    })
    await expect(
      pool.connect(
        channelPeer(),
        { ...channelReady, receiverIncarnationId: '9'.repeat(32) },
        channelPort(),
      ),
    ).rejects.toMatchObject({ reason: 'authentication' })
    expect(pool.retryAuthentication(channelReady.pairId, false)).toBe(false)
    expect(dial).toHaveBeenCalledOnce()
    expect(pacing.authenticationRequired).toHaveBeenCalledOnce()
    expect(pool.retryAuthentication(channelReady.pairId, true)).toBe(true)
    await expect(pool.connect(channelPeer(), channelReady, channelPort())).rejects.toMatchObject({
      reason: 'authentication',
    })
    expect(dial).toHaveBeenCalledTimes(2)
  })
  it('shares one authenticated ready channel per pair and performs no construction or port-probe I/O', async () => {
    const fixture = fakeChannelSocket()
    const dial = vi.fn<DeviceChannelDialer['dial']>(() => Promise.resolve(fixture.socket))
    const { pool } = pacer({ dial })
    expect(dial).not.toHaveBeenCalled()
    const first = pool.connect(channelPeer(), channelReady, channelPort())
    const second = pool.connect(channelPeer(), channelReady, channelPort())
    expect(first).toBe(second)
    const channel = await first
    expect(await second).toBe(channel)
    expect(await pool.connect(channelPeer(), channelReady, channelPort())).toBe(channel)
    expect(dial).toHaveBeenCalledOnce()
    const payloads = fixture.write.mock.calls.map(([bytes]) =>
      new TextDecoder().decode(typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes),
    )
    expect(payloads[0]).toContain('ready')
    expect(payloads.every((text) => !text.includes('probe'))).toBe(true)
    await expect(
      pool.connect(
        { ...channelPeer(), peerFingerprint: 'f'.repeat(64) },
        channelReady,
        channelPort(),
      ),
    ).rejects.toMatchObject({ reason: 'authentication' })
  })
  it('aborts a silent handshake without freeing its slot before the dialer settles and destroys late sockets', async () => {
    pacingClock()
    const wait = Promise.withResolvers<ReturnType<typeof fakeChannelSocket>['socket']>()
    const dial = vi.fn<DeviceChannelDialer['dial']>(() => wait.promise)
    const { pool } = pacer({ dial })
    const result = settleChannel(pool.connect(channelPeer(), channelReady, channelPort()))
    await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.handshakeDeadlineMs)
    expect(dial.mock.calls[0]![1].aborted).toBe(true)
    expect(dial).toHaveBeenCalledOnce()
    const fixture = fakeChannelSocket()
    wait.resolve(fixture.socket)
    await tick()
    expect(fixture.socket.destroyed).toBe(true)
    pool.close()
    await result
  })
  it('paces reconnect after a closed channel and caps queued pairs, including revoked requests', async () => {
    pacingClock()
    const dial = vi.fn<DeviceChannelDialer['dial']>((peer) =>
      Promise.resolve(fakeChannelSocket({ ...channelReady, pairId: peer.pairId }).socket),
    )
    const { pool, pacing } = pacer({ dial })
    const channel = await pool.connect(channelPeer(), channelReady, channelPort())
    channel.close()
    const retry = pool.connect(channelPeer(), channelReady, channelPort())
    expect(dial).toHaveBeenCalledOnce()
    expect(pacing.throttled).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'handshake-backoff' }),
    )
    await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.handshakeBackoffBaseMs)
    expect(await retry).not.toBe(channel)
    expect(dial).toHaveBeenCalledTimes(2)
    await expect(
      pool.connect({ ...channelPeer(), isActive: () => false }, channelReady, channelPort()),
    ).rejects.toThrow('revoked')
    const never = Promise.withResolvers<never>()
    const queued = pacer({ dial: () => never.promise }).pool
    const requests = Array.from({ length: DEVICE_LIMITS.pairedDevices }, (_, index) => {
      const peer = channelPeer(index.toString(16).repeat(32))
      return settleChannel(
        queued.connect(peer, { ...channelReady, pairId: peer.pairId }, channelPort()),
      )
    })
    const extra = channelPeer('f0'.repeat(16))
    await expect(
      queued.connect(extra, { ...channelReady, pairId: extra.pairId }, channelPort()),
    ).rejects.toThrow('capacity')
    queued.close()
    never.reject(new DeviceChannelDialFailure('transport'))
    await Promise.all(requests)
    await expect(queued.connect(channelPeer(), channelReady, channelPort())).rejects.toThrow(
      'revoked',
    )
    expect(queued.retryAuthentication(channelReady.pairId, true)).toBe(false)
  })
})
