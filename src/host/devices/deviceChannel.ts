import { type TLSSocket } from 'node:tls'
import { DEVICE_LIMITS } from '../../shared/constants'
import { type DeviceFrame, type DEVICE_FAILURES } from '../../shared/devices'
import { DeviceFrameDecoder, encodeDeviceFrame } from '../../core/devices/deviceFraming'

export interface DeviceChannel {
  readonly pairId: string
  readonly receiverIncarnationId: string | undefined
  readonly isReceiver: boolean
  send(frame: DeviceFrame): void
  close(): void
}

export interface DeviceChannelPort {
  // The receiver sends its current offers here; the source waits for those
  // authenticated offers before connected fires or it can send any request.
  connected(channel: DeviceChannel): void
  receive(frame: DeviceFrame, channel: DeviceChannel): Promise<void>
  // Observation only: E retains unresolved ownership/occupancy/liability.
  disconnected(reason: (typeof DEVICE_FAILURES)[number]): void
}

export function openDeviceChannel(
  socket: TLSSocket,
  pairId: string,
  receiverIncarnationId: string | undefined,
  isActive: () => boolean,
  port: DeviceChannelPort,
  ready: (channel: DeviceChannel) => void = () => {
    /* Optional transport readiness observer. */
  },
): DeviceChannel {
  const decoder = new DeviceFrameDecoder()
  const queue: DeviceFrame[] = []
  let isRunning = false
  let frameTimer: ReturnType<typeof setTimeout> | undefined
  let frameStartedAt: number | undefined
  let failure: (typeof DEVICE_FAILURES)[number] = 'blocked-or-unreachable'
  let currentIncarnation = receiverIncarnationId
  const isMatching = (frame: DeviceFrame) =>
    frame.pairId === pairId && frame.receiverIncarnationId === currentIncarnation
  const channel: DeviceChannel = {
    pairId,
    isReceiver: receiverIncarnationId !== undefined,
    get receiverIncarnationId() {
      return currentIncarnation
    },
    send(frame) {
      if (socket.destroyed || !isActive() || !isMatching(frame)) {
        socket.destroy()
        throw new Error('revoked')
      }
      const bytes = encodeDeviceFrame(frame)
      if (socket.writableLength + bytes.length > DEVICE_LIMITS.frameBytes) {
        socket.destroy()
        throw new Error('capacity')
      }
      socket.write(bytes)
    },
    close() {
      socket.destroy()
    },
  }
  async function drain(): Promise<void> {
    if (isRunning) return
    isRunning = true
    try {
      while (queue.length > 0 && !socket.destroyed) {
        const frame = queue.shift()
        if (frame === undefined || !isActive() || !isMatching(frame)) {
          socket.destroy()
          break
        }
        await port.receive(frame, channel)
      }
    } catch {
      socket.destroy()
    } finally {
      isRunning = false
    }
  }
  socket.setTimeout(DEVICE_LIMITS.idleConnectionMs, () => socket.destroy())
  socket.on('error', () => socket.destroy())
  socket.on('data', (chunk: Buffer) => {
    try {
      if (!isActive()) throw new Error('revoked')
      if (
        frameStartedAt !== undefined &&
        Date.now() - frameStartedAt >= DEVICE_LIMITS.frameDeadlineMs
      )
        throw new Error('invalid-frame')
      const frames = decoder.push(
        chunk,
        DEVICE_LIMITS.queuedFrames - queue.length - Number(isRunning),
      )
      const isInitialOffer = currentIncarnation === undefined && frames.length > 0
      if (isInitialOffer) {
        const first = frames[0]
        if (first?.pairId !== pairId || first.body.kind !== 'offers')
          throw new Error('invalid-frame')
        currentIncarnation = first.receiverIncarnationId
      }
      if (frames.some((frame) => !isMatching(frame))) throw new Error('invalid-frame')
      queue.push(...frames)
      if (isInitialOffer) {
        port.connected(channel)
        ready(channel)
      }
      // A completed frame followed by an incomplete frame gets a fresh absolute
      // deadline; trickling bytes within one frame never extends its deadline.
      if (!decoder.incomplete || frames.length > 0) {
        clearTimeout(frameTimer)
        frameTimer = undefined
        frameStartedAt = undefined
      }
      if (frameTimer === undefined && decoder.incomplete) {
        frameStartedAt = Date.now()
        frameTimer = setTimeout(() => {
          failure = 'invalid-frame'
          socket.destroy()
        }, DEVICE_LIMITS.frameDeadlineMs)
      }
      void drain()
    } catch (error) {
      failure =
        error instanceof Error && error.message === 'incompatible'
          ? 'incompatible'
          : 'invalid-frame'
      socket.destroy()
    }
  })
  socket.once('close', () => {
    clearTimeout(frameTimer)
    queue.length = 0
    port.disconnected(failure)
  })
  if (currentIncarnation !== undefined) {
    try {
      port.connected(channel)
      ready(channel)
    } catch {
      socket.destroy()
    }
  }
  return channel
}
