import { createHash } from 'node:crypto'
import { Socket } from 'node:net'
import { TLSSocket } from 'node:tls'
import { vi } from 'vitest'
import {
  DEVICE_STREAMS,
  type DeviceGrantRequest,
  type DeviceReady,
} from '../../../src/shared/devices'
import {
  MultiplexedDeviceChannel,
  type MultiplexedDeviceMessage,
} from '../../../src/core/devices/channel'
import {
  type DeviceChannelPeer,
  type MultiplexedDevicePort,
} from '../../../src/host/devices/deviceChannel'
import { deviceTestFrame } from './deviceTransportFixtures'
import { deviceCaps } from './deviceFixtures'

export const channelReady: DeviceReady = {
  version: deviceTestFrame.version,
  pairId: deviceTestFrame.pairId,
  receiverIncarnationId: deviceTestFrame.receiverIncarnationId,
  requestId: deviceTestFrame.requestId,
  streams: [...DEVICE_STREAMS],
}
export const stopMessage: MultiplexedDeviceMessage = {
  kind: 'frame',
  frame: {
    ...deviceTestFrame,
    body: {
      kind: 'cancel',
      identity: {
        pairId: deviceTestFrame.pairId,
        receiverIncarnationId: deviceTestFrame.receiverIncarnationId,
        boardId: 'd'.repeat(32),
        taskId: 'e'.repeat(32),
        attemptId: 'f'.repeat(32),
      },
    },
  },
}
export const bulkMessage: MultiplexedDeviceMessage = {
  kind: 'frame',
  frame: {
    ...deviceTestFrame,
    body: {
      kind: 'artifactChunk',
      identity:
        stopMessage.frame.body.kind === 'cancel'
          ? stopMessage.frame.body.identity
          : (() => {
              throw new Error('fixture')
            })(),
      artifactId: '0'.repeat(32),
      offset: 0,
      base64: Buffer.alloc(10_000).toString('base64'),
    },
  },
}

export function channelPort(): MultiplexedDevicePort {
  return { connected: vi.fn(), receive: vi.fn(() => Promise.resolve()), disconnected: vi.fn() }
}

export function channelPeer(pairId = channelReady.pairId): DeviceChannelPeer {
  return {
    pairId,
    peerFingerprint: createHash('sha256').update('synthetic-TLS-peer').digest('hex'),
    isActive: () => true,
  }
}

export function fakeChannelSocket(ready = channelReady, shouldAnswerReady = true) {
  const socket = new TLSSocket(new Socket())
  socket.authorized = true
  vi.spyOn(socket, 'getPeerCertificate').mockReturnValue(
    Object.assign(socket.getPeerCertificate(), {
      raw: Buffer.from('synthetic-TLS-peer'),
      fingerprint256: channelPeer().peerFingerprint,
    }),
  )
  vi.spyOn(socket, 'getProtocol').mockReturnValue('TLSv1.3')
  vi.spyOn(socket, 'isSessionReused').mockReturnValue(false)
  const remote = new MultiplexedDeviceChannel(ready)
  function flush() {
    let response = remote.nextPacket()
    while (response !== undefined) {
      const bytes = response
      queueMicrotask(() => {
        if (!socket.destroyed) socket.emit('data', Buffer.from(bytes))
      })
      response = remote.nextPacket()
    }
  }
  const write = vi.spyOn(socket, 'write').mockImplementation((chunk) => {
    if (typeof chunk === 'string') throw new Error('binary carriage expected')
    remote.push(chunk)
    for (const isControl of [true, false]) {
      let delivery = remote.takeIncoming(isControl)
      while (delivery !== undefined) {
        if (shouldAnswerReady && delivery.message.kind === 'ready') remote.enqueue(delivery.message)
        remote.complete(delivery)
        delivery = remote.takeIncoming(isControl)
      }
    }
    flush()
    return true
  })
  return { socket, write, remote, flush }
}

export function transferChannel(
  source: MultiplexedDeviceChannel,
  target: MultiplexedDeviceChannel,
) {
  const packets: Uint8Array[] = []
  let packet = source.nextPacket()
  while (packet !== undefined) {
    packets.push(packet)
    target.push(packet)
    packet = source.nextPacket()
  }
  return packets
}

export function channelPacket(bytes: string | Uint8Array): Record<string, unknown> {
  const packet: Record<string, unknown> = JSON.parse(
    typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes),
  )
  return packet
}

export async function settleChannel<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch {
    return undefined
  }
}

export function channelGrantRequest(): DeviceGrantRequest {
  return {
    version: 1,
    pairId: channelReady.pairId,
    ownerId: 'c'.repeat(32),
    roleId: 'd'.repeat(32),
    mode: 'manual',
    repositoryId: 'e'.repeat(32),
    lanes: true,
    checks: true,
    quota: deviceCaps,
  }
}
