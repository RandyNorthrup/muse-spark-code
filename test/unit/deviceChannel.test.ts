import { Socket } from 'node:net'
import { TLSSocket } from 'node:tls'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { DeviceFrameDecoder, encodeDeviceFrame } from '../../src/core/devices/deviceFraming'
import { openDeviceChannel } from '../../src/host/devices/deviceChannel'
import { deviceTestFrame, transportHandler } from './helpers/deviceTransportFixtures'

const sockets = new Set<TLSSocket>()
afterEach(() => {
  vi.useRealTimers()
  for (const socket of sockets) socket.destroy()
  sockets.clear()
})
function fixture(isActive = () => true, isSource = false) {
  const socket = new TLSSocket(new Socket())
  sockets.add(socket)
  const handler = transportHandler(false)
  const channel = openDeviceChannel(
    socket,
    deviceTestFrame.pairId,
    isSource ? undefined : deviceTestFrame.receiverIncarnationId,
    isActive,
    handler,
  )
  return { socket, handler, channel }
}

describe('authenticated device channel bounds', () => {
  it('learns current receiver metadata only from initial paired offers and keeps it fixed', () => {
    const { socket, handler, channel } = fixture(() => true, true)
    expect(handler.connected).not.toHaveBeenCalled()
    expect(channel.receiverIncarnationId).toBeUndefined()
    socket.emit('data', encodeDeviceFrame(deviceTestFrame))
    expect(handler.connected).toHaveBeenCalledTimes(1)
    expect(channel.receiverIncarnationId).toBe(deviceTestFrame.receiverIncarnationId)
    socket.emit(
      'data',
      encodeDeviceFrame({ ...deviceTestFrame, receiverIncarnationId: 'd'.repeat(32) }),
    )
    expect(socket.destroyed).toBe(true)
    expect(handler.connected).toHaveBeenCalledTimes(1)
    expect(handler.receive).toHaveBeenCalledTimes(1)
  })
  it('refuses requests before a source has learned the authenticated receiver incarnation', () => {
    const { socket, channel } = fixture(() => true, true)
    const write = vi.spyOn(socket, 'write')
    expect(() => {
      channel.send(deviceTestFrame)
    }).toThrow('revoked')
    expect(write).not.toHaveBeenCalled()
    expect(socket.destroyed).toBe(true)
  })
  it('rejects foreign, non-offer and coalesced mismatched introductions before readiness', () => {
    for (const bytes of [
      encodeDeviceFrame({ ...deviceTestFrame, pairId: 'd'.repeat(32) }),
      encodeDeviceFrame({ ...deviceTestFrame, body: { kind: 'failure', reason: 'capacity' } }),
      Buffer.concat([
        encodeDeviceFrame(deviceTestFrame),
        encodeDeviceFrame({ ...deviceTestFrame, receiverIncarnationId: 'd'.repeat(32) }),
      ]),
    ]) {
      const { socket, handler } = fixture(() => true, true)
      socket.emit('data', bytes)
      expect(handler.connected).not.toHaveBeenCalled()
      expect(handler.receive).not.toHaveBeenCalled()
      expect(socket.destroyed).toBe(true)
    }
  })
  it('drops revoked traffic before decoding and closes when Node reports an idle timeout', async () => {
    const revoked = fixture(() => false)
    const decode = vi.spyOn(DeviceFrameDecoder.prototype, 'push')
    try {
      revoked.socket.emit('data', encodeDeviceFrame(deviceTestFrame))
      expect(decode).not.toHaveBeenCalled()
      expect(revoked.handler.receive).not.toHaveBeenCalled()
    } finally {
      decode.mockRestore()
    }
    const idle = fixture()
    const closed = new Promise<void>((resolve) => idle.socket.once('close', resolve))
    idle.socket.emit('timeout')
    expect(idle.socket.destroyed).toBe(true)
    await closed
    expect(idle.handler.disconnected).toHaveBeenCalledWith('blocked-or-unreachable')
    expect(idle.handler.receive).not.toHaveBeenCalled()
  })
  it('provides a fixed incompatible reason for local upgrade recovery', async () => {
    const { socket, handler } = fixture()
    const closed = new Promise<void>((resolve) => socket.once('close', resolve))
    socket.emit('data', Buffer.from(`${JSON.stringify({ ...deviceTestFrame, version: 0 })}\n`))
    await closed
    expect(handler.disconnected).toHaveBeenCalledWith('incompatible')
    expect(handler.receive).not.toHaveBeenCalled()
  })
  it('enforces absolute incomplete-frame time without resetting for trickled bytes', async () => {
    vi.useFakeTimers()
    const { socket, handler } = fixture()
    socket.emit('data', Buffer.from('{'))
    await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.frameDeadlineMs - 1)
    socket.emit('data', Buffer.from(' '))
    expect(socket.destroyed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(socket.destroyed).toBe(true)
    expect(handler.receive).not.toHaveBeenCalled()
  })
  it('checks elapsed deadlines before parse even when the timer callback is delayed', () => {
    vi.useFakeTimers()
    const { socket, handler } = fixture()
    const bytes = encodeDeviceFrame(deviceTestFrame)
    socket.emit('data', bytes.subarray(0, 1))
    vi.setSystemTime(Date.now() + DEVICE_LIMITS.frameDeadlineMs)
    socket.emit('data', bytes.subarray(1))
    expect(handler.receive).not.toHaveBeenCalled()
    expect(socket.destroyed).toBe(true)
  })
  it('clears completed-frame deadlines and starts a separate next-frame deadline', async () => {
    vi.useFakeTimers()
    const { socket, handler } = fixture()
    const bytes = encodeDeviceFrame(deviceTestFrame)
    socket.emit('data', bytes.subarray(0, 1))
    await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.frameDeadlineMs - 1)
    socket.emit('data', bytes.subarray(1))
    await vi.advanceTimersByTimeAsync(1)
    expect(socket.destroyed).toBe(false)
    expect(handler.receive).toHaveBeenCalledTimes(1)
    socket.emit('data', Buffer.from('{'))
    await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.frameDeadlineMs)
    expect(socket.destroyed).toBe(true)
  })
  it('bounds queued frames across chunks while an admitted handler is waiting', () => {
    const { socket, handler } = fixture()
    handler.receive = vi.fn(
      () =>
        new Promise<void>(() => {
          /* Held until disconnect; no admission completes. */
        }),
    )
    const bytes = encodeDeviceFrame(deviceTestFrame)
    for (let index = 0; index < DEVICE_LIMITS.queuedFrames + 1; index += 1)
      socket.emit('data', bytes)
    expect(handler.receive).toHaveBeenCalledTimes(1)
    expect(socket.destroyed).toBe(true)
  })
  it('rechecks revocation between queued requests rather than trusting the handshake', async () => {
    let isActive = true
    const { socket, handler } = fixture(() => isActive)
    const finish = Promise.withResolvers<undefined>()
    handler.receive = vi.fn(() => finish.promise)
    socket.emit(
      'data',
      Buffer.concat([encodeDeviceFrame(deviceTestFrame), encodeDeviceFrame(deviceTestFrame)]),
    )
    isActive = false
    finish.resolve(undefined)
    await Promise.resolve()
    expect(handler.receive).toHaveBeenCalledTimes(1)
    expect(socket.destroyed).toBe(true)
  })
  it.each(['pairId', 'receiverIncarnationId'] as const)(
    'binds each incoming envelope to the authenticated %s',
    (field) => {
      const { socket, handler } = fixture()
      socket.emit('data', encodeDeviceFrame({ ...deviceTestFrame, [field]: 'd'.repeat(32) }))
      expect(handler.receive).not.toHaveBeenCalled()
      expect(socket.destroyed).toBe(true)
    },
  )
  it('refuses revoked, foreign and backpressured outbound frames', () => {
    const inactive = fixture(() => false)
    expect(() => {
      inactive.channel.send(deviceTestFrame)
    }).toThrow('revoked')
    const foreign = fixture()
    expect(() => {
      foreign.channel.send({ ...deviceTestFrame, pairId: 'd'.repeat(32) })
    }).toThrow('revoked')
    const full = fixture()
    Object.defineProperty(full.socket, 'writableLength', { value: DEVICE_LIMITS.frameBytes })
    const write = vi.spyOn(full.socket, 'write')
    expect(() => {
      full.channel.send(deviceTestFrame)
    }).toThrow('capacity')
    expect(write).not.toHaveBeenCalled()
  })
  it('closes on malformed/old/oversize frames before calling the receiver', () => {
    for (const bytes of [
      Buffer.from('{}\n'),
      Buffer.from(JSON.stringify({ ...deviceTestFrame, version: 0 }) + '\n'),
      Buffer.alloc(DEVICE_LIMITS.frameBytes + 1),
    ]) {
      const { socket, handler } = fixture()
      socket.emit('data', bytes)
      expect(socket.destroyed).toBe(true)
      expect(handler.receive).not.toHaveBeenCalled()
    }
  })
  it('turns handler failure into disconnection without reflecting secret/path/error text', async () => {
    const { socket, handler } = fixture()
    handler.receive = vi.fn(() => Promise.reject(new Error('synthetic-private-path-sentinel')))
    socket.emit('data', encodeDeviceFrame(deviceTestFrame))
    await Promise.resolve()
    expect(socket.destroyed).toBe(true)
  })
})
