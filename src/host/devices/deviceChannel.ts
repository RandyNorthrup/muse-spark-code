import { type TLSSocket } from 'node:tls'
import type { Logger } from '../logger'
import { failureForLog } from '../../core/backends/musecode/logText'
import { DEVICE_LIMITS } from '../../shared/constants'
import {
  type DeviceFrame,
  type DEVICE_FAILURES,
  type DeviceReady,
  type DeviceThrottled,
  canOpenHandshake,
  canRetryAuth,
  handshakeBackoffMs,
  deviceReadySchema,
} from '../../shared/devices'
import { MultiplexedDeviceChannel, type MultiplexedDeviceMessage } from '../../core/devices/channel'
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
  // E must Stop this pair on invalid/incompatible framing before reporting;
  // all disconnects retain unresolved ownership/occupancy/liability.
  disconnected(reason: (typeof DEVICE_FAILURES)[number], channel: DeviceChannel): void
}

export function openDeviceChannel(
  socket: TLSSocket,
  pairId: string,
  receiverIncarnationId: string | undefined,
  isActive: () => boolean,
  port: DeviceChannelPort,
  log: Logger,
  ready: (channel: DeviceChannel) => void = () => {
    /* Optional transport readiness observer. */
  },
): DeviceChannel {
  const decoder = new DeviceFrameDecoder()
  const queue: DeviceFrame[] = []
  let isRunning = false
  let controls = 0
  let frameTimer: ReturnType<typeof setTimeout> | undefined
  let frameStartedAt: { monotonic: number; wall: number; observedWall: number } | undefined
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
  function checkFrameDeadline(): void {
    if (frameStartedAt === undefined) return
    const wallNow = Date.now()
    if (
      performance.now() - frameStartedAt.monotonic >= DEVICE_LIMITS.frameDeadlineMs ||
      wallNow - frameStartedAt.wall >= DEVICE_LIMITS.frameDeadlineMs ||
      wallNow < frameStartedAt.observedWall
    )
      throw new Error('invalid-frame')
    frameStartedAt.observedWall = wallNow
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
    } catch (error) {
      log.error(`Devices channel drain failed: ${failureForLog(error)}`)
      socket.destroy()
    } finally {
      isRunning = false
    }
  }
  async function control(frame: DeviceFrame): Promise<void> {
    controls += 1
    try {
      if (socket.destroyed || !isActive() || !isMatching(frame)) throw new Error('revoked')
      // Cancellation must not wait for dispatch approval or launch confirmation.
      await port.receive(frame, channel)
    } catch (error) {
      if (error instanceof Error && error.message === 'revoked') {
        socket.destroy()
        return
      }
      log.error(`Devices channel control failed: ${failureForLog(error)}`)
      socket.destroy()
    } finally {
      controls -= 1
    }
  }
  socket.setTimeout(DEVICE_LIMITS.idleConnectionMs, () => socket.destroy())
  socket.on('error', () => socket.destroy())
  socket.on('data', (chunk: Buffer) => {
    try {
      if (!isActive()) throw new Error('revoked')
      checkFrameDeadline()
      let completedControls = 0
      let completedRefusals = 0
      const frames = decoder.push(
        chunk,
        {
          available: DEVICE_LIMITS.queuedFrames - queue.length - Number(isRunning),
          refuse(frame) {
            checkFrameDeadline()
            if (!isActive() || !isMatching(frame)) throw new Error('invalid-frame')
            completedRefusals += 1
            channel.send({ ...frame, body: { kind: 'failure', reason: 'capacity' } })
          },
        },
        {
          available: DEVICE_LIMITS.controlFrames - controls,
          receive(frame) {
            checkFrameDeadline()
            if (!isActive() || !isMatching(frame)) throw new Error('invalid-frame')
            completedControls += 1
            void control(frame)
          },
        },
      )
      checkFrameDeadline()
      const isInitialOffer = currentIncarnation === undefined && frames.length > 0
      if (isInitialOffer) {
        const first = frames[0]
        if (first?.pairId !== pairId || first.body.kind !== 'offers')
          throw new Error('invalid-frame')
        currentIncarnation = first.receiverIncarnationId
      }
      if (frames.some((frame) => !isMatching(frame))) throw new Error('invalid-frame')
      if (isInitialOffer) {
        if (!isActive()) throw new Error('revoked')
        port.connected(channel)
        ready(channel)
      }
      // A completed frame followed by an incomplete frame gets a fresh absolute
      // deadline; trickling bytes within one frame never extends its deadline.
      if (
        !decoder.incomplete ||
        frames.length > 0 ||
        completedControls > 0 ||
        completedRefusals > 0
      ) {
        clearTimeout(frameTimer)
        frameTimer = undefined
        frameStartedAt = undefined
      }
      if (frameTimer === undefined && decoder.incomplete) {
        const wall = Date.now()
        frameStartedAt = { monotonic: performance.now(), wall, observedWall: wall }
        frameTimer = setTimeout(() => {
          failure = 'invalid-frame'
          socket.destroy()
        }, DEVICE_LIMITS.frameDeadlineMs)
      }
      for (const frame of frames) {
        queue.push(frame)
        void drain()
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'incompatible') {
        failure = 'incompatible'
        log.warn('Devices channel peer is incompatible')
      } else if (error instanceof Error && error.message === 'invalid-frame') {
        failure = 'invalid-frame'
      } else {
        failure = 'invalid-frame'
        log.error(`Devices channel data failed: ${failureForLog(error)}`)
      }
      socket.destroy()
    }
  })
  socket.once('close', () => {
    clearTimeout(frameTimer)
    queue.length = 0
    port.disconnected(failure, channel)
  })
  if (currentIncarnation !== undefined) {
    try {
      port.connected(channel)
      ready(channel)
    } catch (error) {
      log.error(`Devices channel connect failed: ${failureForLog(error)}`)
      socket.destroy()
    }
  }
  return channel
}

// Phase 2 is wired by lane W. A dialer supplies an address-policy-checked
// socket; this carriage independently checks mutual TLS and the saved pin.
export interface DeviceChannelPeer {
  readonly pairId: string
  readonly peerFingerprint: string
  isActive(): boolean
}
export interface PacedDeviceChannel {
  readonly pairId: string
  readonly closed: boolean
  readonly failure: 'authentication' | 'transport' | undefined
  readonly ready: Promise<DeviceReady>
  health(): Promise<DeviceReady>
  send(message: MultiplexedDeviceMessage): boolean
  close(): void
}
export interface MultiplexedDevicePort {
  connected(channel: PacedDeviceChannel): void
  receive(message: MultiplexedDeviceMessage, channel: PacedDeviceChannel): Promise<void>
  disconnected(channel: PacedDeviceChannel): void
}

// Node 20 (the supported editor floor) has no Promise.withResolvers.
function channelWait<T>() {
  let settle: { resolve(value: T): void; reject(error: Error): void } | undefined
  const promise = new Promise<T>((resolve, reject) => {
    settle = { resolve, reject }
  })
  if (settle === undefined) throw new Error('invalid-state')
  return { promise, ...settle }
}

function isAuthenticatedChannel(socket: TLSSocket, peer: DeviceChannelPeer): boolean {
  const certificate = socket.getPeerCertificate()
  return (
    !socket.destroyed &&
    socket.authorized &&
    socket.getProtocol() === 'TLSv1.3' &&
    !socket.isSessionReused() &&
    Buffer.isBuffer(certificate.raw) &&
    certificate.fingerprint256.replaceAll(':', '').toLowerCase() === peer.peerFingerprint &&
    peer.isActive()
  )
}

// Authentication failures have their own typed cause: transport resets must
// back off, while a bad credential/pin must stop and ask exactly once.
export class DeviceChannelDialFailure extends Error {
  constructor(readonly reason: 'authentication' | 'transport') {
    super(reason)
    this.name = 'DeviceChannelDialFailure'
  }
}

export function openMultiplexedDeviceChannel(
  socket: TLSSocket,
  peer: DeviceChannelPeer,
  input: DeviceReady,
  isReceiver: boolean,
  port: MultiplexedDevicePort,
  log: Logger,
): PacedDeviceChannel {
  const core = new MultiplexedDeviceChannel(input)
  const ready = core.identity
  if (ready.pairId !== peer.pairId || !isAuthenticatedChannel(socket, peer)) {
    socket.destroy()
    throw new DeviceChannelDialFailure('authentication')
  }
  const initial = channelWait<DeviceReady>()
  const waits = new Map<
    string,
    {
      resolve(value: DeviceReady): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
      started: number
      wall: number
    }
  >()
  let isReady = false
  let failure: PacedDeviceChannel['failure']
  let isClosed = false
  let isBlocked = false
  let isWriting = false
  let frameTimer: ReturnType<typeof setTimeout> | undefined
  let frameStart: { monotonic: number; wall: number; observedWall: number } | undefined
  let isControlRunning = false
  let isDataRunning = false

  function fail(error: unknown): void {
    if (error instanceof DeviceChannelDialFailure) {
      failure = error.reason
      initial.reject(error)
    } else failure ??= 'transport'
    channel.close()
  }
  function requireAuthentication(): void {
    if (!isAuthenticatedChannel(socket, peer)) throw new DeviceChannelDialFailure('authentication')
  }
  function write(): void {
    if (isWriting || isBlocked || isClosed) return
    isWriting = true
    try {
      requireAuthentication()
      let packet = core.nextPacket()
      while (packet !== undefined) {
        if (socket.writableLength + packet.byteLength > DEVICE_LIMITS.frameBytes)
          throw new Error('capacity')
        if (!socket.write(packet)) {
          isBlocked = true
          break
        }
        requireAuthentication()
        packet = core.nextPacket()
      }
    } finally {
      isWriting = false
    }
  }
  function canSend(message: MultiplexedDeviceMessage): boolean {
    requireAuthentication()
    const isAccepted = core.enqueue(message)
    if (isAccepted) write()
    return isAccepted
  }
  function announce(): void {
    if (isReady) return
    isReady = true
    initial.resolve(ready)
    port.connected(channel)
  }
  function health(): Promise<DeviceReady> {
    if (isReceiver || isClosed || waits.size >= DEVICE_LIMITS.controlFrames)
      return Promise.reject(new Error('capacity'))
    const request = { ...ready, requestId: globalThis.crypto.randomUUID().replaceAll('-', '') }
    return new Promise<DeviceReady>((resolve, reject) => {
      const timer = setTimeout(() => {
        waits.delete(request.requestId)
        reject(new Error('unknown'))
        channel.close()
      }, DEVICE_LIMITS.handshakeDeadlineMs)
      waits.set(request.requestId, {
        resolve,
        reject,
        timer,
        started: performance.now(),
        wall: Date.now(),
      })
      try {
        if (!canSend({ kind: 'ready', ready: request })) throw new Error('capacity')
      } catch (error) {
        clearTimeout(timer)
        waits.delete(request.requestId)
        if (error instanceof DeviceChannelDialFailure) {
          reject(error)
          return
        }
        if (error instanceof Error && error.message === 'capacity') {
          reject(new Error('unknown'))
          return
        }
        log.error(`Devices channel health failed: ${failureForLog(error)}`)
        reject(new Error('unknown', { cause: error }))
      }
    })
  }
  const channel: PacedDeviceChannel = {
    pairId: peer.pairId,
    get closed() {
      return isClosed || socket.destroyed
    },
    get failure() {
      return failure
    },
    ready: initial.promise,
    health,
    send(message) {
      if (!isReady) throw new Error('unknown')
      try {
        return canSend(message)
      } catch (error) {
        fail(error)
        throw error
      }
    },
    close() {
      if (isClosed) return
      isClosed = true
      clearTimeout(frameTimer)
      clearInterval(keepAlive)
      for (const wait of waits.values()) {
        clearTimeout(wait.timer)
        wait.reject(new Error('unknown'))
      }
      waits.clear()
      initial.reject(new Error('unknown'))
      core.close()
      socket.destroy()
    },
  }
  async function drain(isControl: boolean): Promise<void> {
    if (isControl ? isControlRunning : isDataRunning) return
    if (isControl) isControlRunning = true
    else isDataRunning = true
    try {
      let delivery = core.takeIncoming(isControl)
      while (delivery !== undefined && !isClosed) {
        requireAuthentication()
        if (delivery.message.kind === 'ready') {
          const input = delivery.message.ready
          if (isReceiver) {
            if (!canSend({ kind: 'ready', ready: input })) throw new Error('capacity')
          } else {
            const wait = waits.get(input.requestId)
            const wallNow = Date.now()
            if (
              wait === undefined ||
              performance.now() - wait.started >= DEVICE_LIMITS.handshakeDeadlineMs ||
              wallNow - wait.wall >= DEVICE_LIMITS.handshakeDeadlineMs ||
              wallNow < wait.wall
            )
              throw new Error('unknown')
            clearTimeout(wait.timer)
            waits.delete(input.requestId)
            wait.resolve(input)
          }
          announce()
        } else {
          if (!isReady) throw new Error('unknown')
          await port.receive(delivery.message, channel)
        }
        if (channel.closed) return
        requireAuthentication()
        core.complete(delivery)
        write()
        delivery = core.takeIncoming(isControl)
      }
    } catch (error) {
      if (error instanceof DeviceChannelDialFailure) {
        fail(error)
        return
      }
      fail(error)
      log.error(`Devices multiplexed drain failed: ${failureForLog(error)}`)
    } finally {
      if (isControl) isControlRunning = false
      else isDataRunning = false
    }
  }
  function checkDeadline(): void {
    if (frameStart === undefined) return
    const wallNow = Date.now()
    if (
      performance.now() - frameStart.monotonic >= DEVICE_LIMITS.frameDeadlineMs ||
      wallNow - frameStart.wall >= DEVICE_LIMITS.frameDeadlineMs ||
      wallNow < frameStart.observedWall
    )
      throw new Error('invalid-frame')
    frameStart.observedWall = wallNow
  }
  const keepAlive = setInterval(() => {
    if (!isReceiver && isReady && waits.size === 0)
      void health().catch((error: unknown) => {
        log.warn(`Devices keepalive failed: ${failureForLog(error)}`)
        channel.close()
      })
  }, DEVICE_LIMITS.idleConnectionMs / 2)
  // The receiver's first request is also bounded; an authenticated but silent
  // peer cannot keep a handshake slot or socket indefinitely.
  const introductionTimer = setTimeout(() => {
    channel.close()
  }, DEVICE_LIMITS.handshakeDeadlineMs)
  void initial.promise
    .then(() => {
      clearTimeout(introductionTimer)
    })
    .catch((error: unknown) => {
      if (error instanceof DeviceChannelDialFailure) {
        clearTimeout(introductionTimer)
        return
      }
      log.warn(`Devices handshake failed: ${failureForLog(error)}`)
      clearTimeout(introductionTimer)
    })
  socket.on('drain', () => {
    isBlocked = false
    try {
      write()
    } catch (error) {
      if (error instanceof DeviceChannelDialFailure) {
        fail(error)
        return
      }
      fail(error)
      log.error(`Devices multiplexed write failed: ${failureForLog(error)}`)
    }
  })
  socket.on('data', (chunk: Buffer) => {
    try {
      requireAuthentication()
      checkDeadline()
      core.push(chunk)
      checkDeadline()
      if (!core.incomplete) {
        clearTimeout(frameTimer)
        frameTimer = undefined
        frameStart = undefined
      } else if (frameTimer === undefined) {
        const wall = Date.now()
        frameStart = { monotonic: performance.now(), wall, observedWall: wall }
        frameTimer = setTimeout(() => {
          channel.close()
        }, DEVICE_LIMITS.frameDeadlineMs)
      }
      write()
      void drain(true)
      void drain(false)
    } catch (error) {
      if (error instanceof DeviceChannelDialFailure) {
        fail(error)
        return
      }
      fail(error)
      log.error(`Devices multiplexed data failed: ${failureForLog(error)}`)
    }
  })
  socket.on('error', () => {
    channel.close()
  })
  socket.once('close', () => {
    channel.close()
    port.disconnected(channel)
  })
  if (!isReceiver)
    void health().catch((error: unknown) => {
      if (error instanceof DeviceChannelDialFailure) {
        initial.reject(error)
        channel.close()
        return
      }
      if (error instanceof Error && error.message === 'unknown') {
        initial.reject(error)
        channel.close()
        return
      }
      log.error(`Devices dial health failed: ${failureForLog(error)}`)
      initial.reject(new Error('unknown', { cause: error }))
      channel.close()
    })
  return channel
}

export interface DeviceChannelDialer {
  // Must honor AbortSignal and destroy a late socket. No TCP health probe:
  // dialing obtains the single TLS channel, ready() establishes its health.
  dial(peer: DeviceChannelPeer, signal: AbortSignal): Promise<TLSSocket>
}
export interface DeviceChannelPacingPort {
  throttled(state: DeviceThrottled): void
  authenticationRequired(pairId: string): void
}
interface ChannelJob {
  isReceiver: boolean
  handshake(signal: AbortSignal): Promise<TLSSocket>
  peer: DeviceChannelPeer
  ready: DeviceReady
  port: MultiplexedDevicePort
  result: ReturnType<typeof channelWait<PacedDeviceChannel>>
  controller: AbortController
  channel: PacedDeviceChannel | undefined
  failures: number
  authFailures: number
  retryAt: number
  unknownSince: number
  running: boolean
  settled: boolean
}

// Construct one per host, shared by every pair. Concurrent callers for one
// pair share the same promise/socket. Waiting and connected pairs count toward
// the existing host pair cap; cancellation does not release a live handshake
// slot until the dialer actually settles.
export class PacedDeviceChannels {
  private readonly jobs = new Map<string, ChannelJob>()
  private pendingHandshakes = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private isClosed = false

  constructor(
    private readonly dialer: DeviceChannelDialer,
    private readonly pacing: DeviceChannelPacingPort,
    private readonly log: Logger,
    private readonly randomSource: () => number = Math.random,
  ) {}

  private throttle(job: ChannelJob, reason: DeviceThrottled['reason']): void {
    this.pacing.throttled({
      version: job.ready.version,
      pairId: job.peer.pairId,
      receiverIncarnationId: job.ready.receiverIncarnationId,
      unknownSince: job.unknownSince,
      reason,
    })
  }

  private pump(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (this.isClosed) return
    let next = Infinity
    for (const job of this.jobs.values()) {
      if (job.running || job.settled || !canRetryAuth(job.authFailures)) continue
      if (!job.peer.isActive()) {
        job.settled = true
        job.result.reject(new Error('revoked'))
        continue
      }
      if (job.retryAt > performance.now()) {
        next = Math.min(next, job.retryAt)
        continue
      }
      if (!canOpenHandshake(this.pendingHandshakes)) {
        this.throttle(job, 'pressure')
        continue
      }
      job.running = true
      this.pendingHandshakes += 1
      void this.run(job)
    }
    if (Number.isFinite(next))
      this.timer = setTimeout(
        () => {
          this.pump()
        },
        Math.max(0, next - performance.now()),
      )
  }

  private async run(job: ChannelJob): Promise<void> {
    let socket: TLSSocket | undefined
    const attempt = job.controller
    const deadline = setTimeout(() => {
      attempt.abort()
    }, DEVICE_LIMITS.handshakeDeadlineMs)
    const onAbort = () => {
      job.channel?.close()
      socket?.destroy()
    }
    attempt.signal.addEventListener('abort', onAbort, { once: true })
    const started = performance.now()
    const wall = Date.now()
    const hasExpired = () =>
      attempt.signal.aborted ||
      this.isClosed ||
      performance.now() - started >= DEVICE_LIMITS.handshakeDeadlineMs ||
      Date.now() - wall >= DEVICE_LIMITS.handshakeDeadlineMs ||
      Date.now() < wall
    const scheduleRetry = () => {
      job.failures += 1
      job.retryAt = performance.now() + handshakeBackoffMs(job.failures, this.randomSource)
      job.controller = new AbortController()
      this.throttle(job, 'handshake-backoff')
      if (!job.isReceiver) return
      job.settled = true
      job.result.reject(new Error('unknown'))
    }
    try {
      socket = await job.handshake(attempt.signal)
      if (hasExpired()) throw new DeviceChannelDialFailure('transport')
      const channel = openMultiplexedDeviceChannel(
        socket,
        job.peer,
        job.ready,
        job.isReceiver,
        {
          connected: (value) => {
            job.port.connected(value)
          },
          receive: (message, value) => job.port.receive(message, value),
          disconnected: (value) => {
            if (value.failure === 'authentication' && canRetryAuth(job.authFailures)) {
              job.authFailures += 1
              this.pacing.authenticationRequired(job.peer.pairId)
            }
            job.port.disconnected(value)
          },
        },
        this.log,
      )
      await channel.ready
      if (channel.closed || hasExpired() || !job.peer.isActive())
        throw new DeviceChannelDialFailure('transport')
      job.settled = true
      job.failures = 0
      job.result.resolve(channel)
    } catch (error) {
      job.channel?.close()
      job.channel = undefined
      socket?.destroy()
      if (this.isClosed || this.jobs.get(job.peer.pairId) !== job || !job.peer.isActive()) {
        this.log.trace('Devices dial revoked')
        job.settled = true
        job.result.reject(new Error('revoked'))
      } else if (error instanceof DeviceChannelDialFailure && error.reason === 'authentication') {
        this.log.warn('Devices dial authentication refused')
        job.settled = true
        job.result.reject(error)
        if (canRetryAuth(job.authFailures)) {
          job.authFailures += 1
          this.pacing.authenticationRequired(job.peer.pairId)
        }
      } else if (error instanceof DeviceChannelDialFailure) {
        this.log.trace('Devices dial transport failed, retrying')
        scheduleRetry()
      } else if (error instanceof Error && error.message === 'unknown') {
        this.log.trace('Devices dial failed, retrying')
        scheduleRetry()
      } else {
        this.log.error(`Devices dial failed: ${failureForLog(error)}`)
        scheduleRetry()
      }
    } finally {
      clearTimeout(deadline)
      attempt.signal.removeEventListener('abort', onAbort)
      job.running = false
      this.pendingHandshakes -= 1
      this.pump()
    }
  }

  private request(
    peer: DeviceChannelPeer,
    ready: DeviceReady,
    port: MultiplexedDevicePort,
    isReceiver: boolean,
    handshake: (signal: AbortSignal) => Promise<TLSSocket>,
  ): Promise<PacedDeviceChannel> {
    const parsed = deviceReadySchema.parse(ready)
    if (this.isClosed || !peer.isActive() || parsed.pairId !== peer.pairId)
      return Promise.reject(new Error('revoked'))
    const existing = this.jobs.get(peer.pairId)
    if (existing !== undefined) {
      if (existing.peer.peerFingerprint !== peer.peerFingerprint)
        return Promise.reject(new DeviceChannelDialFailure('authentication'))
      if (!canRetryAuth(existing.authFailures))
        return Promise.reject(new DeviceChannelDialFailure('authentication'))
      if (existing.ready.receiverIncarnationId !== parsed.receiverIncarnationId) {
        // A current incarnation supplied by the authenticated owner may replace
        // a closed channel, a settled attempt, or an unsettled outbound retry
        // still waiting for backoff — never a live channel or a dial in
        // flight, whose attempt keeps its own identity.
        const isWaitingOutboundRetry =
          !isReceiver &&
          !existing.isReceiver &&
          !existing.running &&
          existing.channel === undefined &&
          !existing.settled
        if (
          !isWaitingOutboundRetry &&
          (existing.running ||
            (existing.channel === undefined ? !existing.settled : !existing.channel.closed))
        )
          return Promise.reject(new Error('unknown'))
        existing.ready = parsed
        existing.peer = peer
      }
      if (
        isReceiver &&
        !existing.channel?.closed &&
        (!existing.isReceiver || !existing.settled || existing.channel !== undefined)
      ) {
        this.throttle(existing, 'pressure')
        return Promise.reject(new Error('capacity'))
      }
      if (existing.channel?.closed || (existing.settled && existing.channel === undefined)) {
        existing.isReceiver = isReceiver
        existing.handshake = handshake
        existing.port = port
      }
      if (existing.channel?.closed) {
        existing.channel = undefined
        existing.settled = false
        existing.failures += 1
        existing.retryAt =
          performance.now() + handshakeBackoffMs(existing.failures, this.randomSource)
        existing.unknownSince = Date.now()
        existing.result = channelWait<PacedDeviceChannel>()
        this.throttle(existing, 'handshake-backoff')
        this.pump()
      } else if (existing.settled && existing.channel === undefined) {
        existing.settled = false
        existing.result = channelWait<PacedDeviceChannel>()
        this.pump()
      }
      return existing.result.promise
    }
    if (this.jobs.size >= DEVICE_LIMITS.pairedDevices) return Promise.reject(new Error('capacity'))
    const job: ChannelJob = {
      isReceiver,
      handshake,
      peer,
      ready: parsed,
      port,
      result: channelWait<PacedDeviceChannel>(),
      controller: new AbortController(),
      channel: undefined,
      failures: 0,
      authFailures: 0,
      retryAt: 0,
      unknownSince: Date.now(),
      running: false,
      settled: false,
    }
    this.jobs.set(peer.pairId, job)
    this.pump()
    return job.result.promise
  }

  connect(
    peer: DeviceChannelPeer,
    ready: DeviceReady,
    port: MultiplexedDevicePort,
  ): Promise<PacedDeviceChannel> {
    return this.request(peer, ready, port, false, (signal) => this.dialer.dial(peer, signal))
  }

  // The listener passes a factory BEFORE starting TLS on its accepted TCP
  // socket. Queued factories do no handshake I/O until the same host-wide
  // pacer admits them. A failed inbound handshake is never retried against the
  // old socket; a fresh incoming connection supplies a new factory, paced by
  // the retained backoff/authentication state. The listener closes a rejected
  // TCP socket and honors the factory's AbortSignal.
  accept(
    peer: DeviceChannelPeer,
    ready: DeviceReady,
    port: MultiplexedDevicePort,
    handshake: (signal: AbortSignal) => Promise<TLSSocket>,
  ): Promise<PacedDeviceChannel> {
    return this.request(peer, ready, port, true, handshake)
  }

  // Only the host's explicit user-consent action may call this method. Merely
  // asking connect() again never clears an authentication failure.
  retryAuthentication(pairId: string, isConfirmed: boolean): boolean {
    const job = this.jobs.get(pairId)
    if (
      !isConfirmed ||
      job === undefined ||
      canRetryAuth(job.authFailures) ||
      job.running ||
      this.isClosed
    )
      return false
    // The next explicit connect owns the new promise and any rejection.
    this.jobs.delete(pairId)
    return true
  }

  close(): void {
    this.isClosed = true
    clearTimeout(this.timer)
    for (const job of this.jobs.values()) {
      job.controller.abort()
      job.channel?.close()
      job.result.reject(new Error('revoked'))
    }
    this.jobs.clear()
  }
}
