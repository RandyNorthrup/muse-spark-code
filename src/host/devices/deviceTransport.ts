import { constants, createHash, createPrivateKey, X509Certificate } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { networkInterfaces } from 'node:os'
import { connect, createServer, type Server, type TLSSocket } from 'node:tls'
import { connect as tcpConnect, type Socket } from 'node:net'
import { DEVICE_LIMITS } from '../../shared/constants'
import { deviceEndpointSchema } from '../../shared/devices'
import {
  checkedDeviceInterface,
  checkedDeviceAddress,
  resolveDeviceAddress,
  type DeviceLookup,
} from '../../core/devices/deviceAddress'
import { openDeviceChannel, type DeviceChannel, type DeviceChannelPort } from './deviceChannel'
import type { Logger } from '../logger'
import { failureForLog } from '../../core/backends/musecode/logText'

// P binds only after bilateral confirmation and durable storage. Active is
// the current pairing/offer state, re-read for each queued request and send.
export interface DeviceTransportPair {
  readonly pairId: string
  readonly receiverIncarnationId: string
  readonly certificate: string
  readonly privateKey: string
  readonly fingerprint: string
  readonly peerCertificate: string
  readonly peerFingerprint: string
  isActive(): boolean
  isOffered(): boolean
}

export interface DeviceNetworkPort {
  interfaces(): readonly string[]
  lookup: DeviceLookup
}

const nodeNetwork: DeviceNetworkPort = {
  interfaces: () =>
    Object.values(networkInterfaces()).flatMap(
      (entries) => entries?.map((entry) => entry.address) ?? [],
    ),
  lookup: async (hostname) => {
    const entries = await lookup(hostname, { all: true })
    return entries.map((entry) => entry.address)
  },
}

function fingerprint(raw: Buffer): string {
  return createHash('sha256').update(raw).digest('hex')
}

function verifyIdentity(pair: DeviceTransportPair): void {
  for (const [pem, pin] of [
    [pair.certificate, pair.fingerprint],
    [pair.peerCertificate, pair.peerFingerprint],
  ]) {
    if (pem === undefined || pin === undefined || pem.length > DEVICE_LIMITS.invitationTextChars) {
      throw new Error('unpaired')
    }
    const certificate = new X509Certificate(pem)
    if (fingerprint(certificate.raw) !== pin || !certificate.verify(certificate.publicKey)) {
      throw new Error('unpaired')
    }
  }
  if (!new X509Certificate(pair.certificate).checkPrivateKey(createPrivateKey(pair.privateKey))) {
    throw new Error('unpaired')
  }
}

function checkIdentity(pair: DeviceTransportPair): void {
  try {
    verifyIdentity(pair)
  } catch (error) {
    throw new Error('unpaired', { cause: error })
  }
}

function isAuthenticated(socket: TLSSocket, pair: DeviceTransportPair): boolean {
  const certificate = socket.getPeerCertificate()
  return (
    socket.authorized &&
    socket.getProtocol() === 'TLSv1.3' &&
    !socket.isSessionReused() &&
    Buffer.isBuffer(certificate.raw) &&
    fingerprint(certificate.raw) === pair.peerFingerprint &&
    pair.isActive()
  )
}

// Constructed only by the lazy Devices factory; construction performs no I/O.
export class DeviceTransport {
  private readonly sockets = new Map<Socket, string>()
  private readonly listeners = new Map<string, Server>()
  private readonly counts = new Map<string, number>()
  private readonly pending = new Map<() => void, string>()
  private total = 0

  constructor(
    private readonly log: Logger,
    private readonly network: DeviceNetworkPort = nodeNetwork,
  ) {}

  private acquire(pairId: string): () => void {
    const count = this.counts.get(pairId) ?? 0
    if (this.total >= DEVICE_LIMITS.connectionsTotal || count >= DEVICE_LIMITS.connectionsPerPair) {
      throw new Error('capacity')
    }
    this.total += 1
    this.counts.set(pairId, count + 1)
    let isReleased = false
    return () => {
      if (isReleased) return
      isReleased = true
      this.total -= 1
      const remaining = (this.counts.get(pairId) ?? 1) - 1
      if (remaining === 0) this.counts.delete(pairId)
      else this.counts.set(pairId, remaining)
    }
  }

  private revokeListener(pairId: string, server: Server): void {
    if (this.listeners.get(pairId) === server) this.revoke(pairId)
  }

  async listen(
    pair: DeviceTransportPair,
    address: string,
    port: number,
    handler: DeviceChannelPort,
  ): Promise<() => void> {
    checkIdentity(pair)
    const local = checkedDeviceInterface(address, this.network.interfaces())
    if (
      !deviceEndpointSchema.safeParse({ address: local, port }).success ||
      !pair.isActive() ||
      !pair.isOffered() ||
      this.listeners.has(pair.pairId)
    )
      throw new Error('unpaired')
    const server = createServer(
      {
        key: pair.privateKey,
        cert: pair.certificate,
        ca: [pair.peerCertificate],
        requestCert: true,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.3',
        maxVersion: 'TLSv1.3',
        secureOptions: constants.SSL_OP_NO_TICKET,
        handshakeTimeout: DEVICE_LIMITS.handshakeDeadlineMs,
      },
      (socket) => {
        if (
          this.listeners.get(pair.pairId) !== server ||
          !isAuthenticated(socket, pair) ||
          !pair.isOffered()
        ) {
          socket.destroy()
          return
        }
        this.sockets.set(socket, pair.pairId)
        socket.once('close', () => this.sockets.delete(socket))
        openDeviceChannel(
          socket,
          pair.pairId,
          pair.receiverIncarnationId,
          () => pair.isActive() && pair.isOffered(),
          handler,
          this.log,
        )
      },
    )
    this.listeners.set(pair.pairId, server)
    server.on('resumeSession', (_sessionId, callback) => {
      callback(null, null)
    })
    server.on('tlsClientError', (_error, socket: TLSSocket) => {
      socket.destroy()
    })
    server.on('connection', (socket: Socket) => {
      try {
        if (this.listeners.get(pair.pairId) !== server || !pair.isActive() || !pair.isOffered())
          throw new Error('revoked')
        checkedDeviceAddress(socket.remoteAddress ?? '')
        const release = this.acquire(pair.pairId)
        this.sockets.set(socket, pair.pairId)
        socket.once('close', () => {
          this.sockets.delete(socket)
          release()
        })
      } catch (error) {
        if (error instanceof Error && error.message === 'revoked') {
          socket.destroy()
          return
        }
        if (error instanceof Error && error.message === 'invalid-device-address') {
          socket.destroy()
          return
        }
        if (error instanceof Error && error.message === 'capacity') {
          socket.destroy()
          return
        }
        socket.destroy()
        this.log.error(`Devices inbound failed: ${failureForLog(error)}`)
      }
    })
    let failure = 'blocked-or-unreachable'
    try {
      await new Promise<void>((resolve, reject) => {
        const startedAt = performance.now()
        const wallStartedAt = Date.now()
        let isSettled = false
        const finish = (error?: Error) => {
          if (isSettled) return
          isSettled = true
          clearTimeout(timer)
          this.pending.delete(cancel)
          server.off('listening', listening)
          server.off('error', failed)
          server.off('close', cancel)
          if (error === undefined) resolve()
          else reject(error)
        }
        const cancel = () => {
          failure = 'revoked'
          finish(new Error(failure))
        }
        const failed = () => {
          finish(new Error('blocked-or-unreachable'))
        }
        const listening = () => {
          const wallNow = Date.now()
          if (
            performance.now() - startedAt >= DEVICE_LIMITS.handshakeDeadlineMs ||
            wallNow - wallStartedAt >= DEVICE_LIMITS.handshakeDeadlineMs ||
            wallNow < wallStartedAt
          )
            failed()
          else if (!pair.isActive() || !pair.isOffered()) cancel()
          else finish()
        }
        const timer = setTimeout(failed, DEVICE_LIMITS.handshakeDeadlineMs)
        this.pending.set(cancel, pair.pairId)
        server.once('error', failed)
        server.once('close', cancel)
        server.once('listening', listening)
        server.on('error', () => {
          this.revokeListener(pair.pairId, server)
        })
        server.listen({ host: local, port, backlog: DEVICE_LIMITS.connectionsTotal })
      })
      if (!pair.isActive() || !pair.isOffered()) {
        failure = 'revoked'
        throw new Error(failure)
      }
      return () => {
        this.revokeListener(pair.pairId, server)
      }
    } catch (error) {
      this.revokeListener(pair.pairId, server)
      throw new Error(failure, { cause: error })
    }
  }

  async connect(
    pair: DeviceTransportPair,
    hostname: string,
    port: number,
    localAddress: string,
    handler: DeviceChannelPort,
  ): Promise<DeviceChannel> {
    checkIdentity(pair)
    if (!pair.isActive() || !Number.isSafeInteger(port) || port < 1 || port > DEVICE_LIMITS.portMax)
      throw new Error('unpaired')
    const local = checkedDeviceInterface(localAddress, this.network.interfaces())
    const release = this.acquire(pair.pairId)
    let timer: ReturnType<typeof setTimeout> | undefined
    let socket: TLSSocket | undefined
    let cancel: (() => void) | undefined
    try {
      return await new Promise<DeviceChannel>((resolve, reject) => {
        let isExpired = false
        let isReady = false
        const startedAt = performance.now()
        const wallStartedAt = Date.now()
        let wallObservedAt = wallStartedAt
        const isWithinDeadline = () => {
          const wallNow = Date.now()
          const isElapsed =
            performance.now() - startedAt >= DEVICE_LIMITS.handshakeDeadlineMs ||
            wallNow - wallStartedAt >= DEVICE_LIMITS.handshakeDeadlineMs ||
            wallNow < wallObservedAt
          wallObservedAt = wallNow
          if (!isExpired && !isElapsed) return true
          isExpired = true
          socket?.destroy()
          reject(new Error('blocked-or-unreachable'))
          return false
        }
        cancel = () => {
          isExpired = true
          socket?.destroy()
          reject(new Error('revoked'))
        }
        this.pending.set(cancel, pair.pairId)
        timer = setTimeout(() => {
          isExpired = true
          socket?.destroy()
          reject(new Error('blocked-or-unreachable'))
        }, DEVICE_LIMITS.handshakeDeadlineMs)
        void resolveDeviceAddress(hostname, local, this.network.lookup)
          .then((address) => {
            if (!isWithinDeadline()) return
            if (isExpired || !pair.isActive()) {
              reject(new Error('revoked'))
              return
            }
            socket = connect({
              host: address,
              port,
              socket: tcpConnect({ host: address, port, localAddress: local }),
              key: pair.privateKey,
              cert: pair.certificate,
              ca: [pair.peerCertificate],
              rejectUnauthorized: true,
              minVersion: 'TLSv1.3',
              maxVersion: 'TLSv1.3',
              secureOptions: constants.SSL_OP_NO_TICKET,
              checkServerIdentity: (_hostname, certificate) =>
                fingerprint(certificate.raw) === pair.peerFingerprint
                  ? undefined
                  : new Error('unpaired'),
            })
            const connected = socket
            this.sockets.set(connected, pair.pairId)
            connected.once('close', () => {
              this.sockets.delete(connected)
              release()
              reject(new Error('blocked-or-unreachable'))
            })
            connected.once('error', () => {
              reject(new Error('blocked-or-unreachable'))
            })
            connected.once('secureConnect', () => {
              if (!isAuthenticated(connected, pair)) {
                connected.destroy()
                reject(new Error('unpaired'))
                return
              }
              if (!isWithinDeadline()) return
              openDeviceChannel(
                connected,
                pair.pairId,
                undefined,
                () => pair.isActive() && (isReady || isWithinDeadline()),
                handler,
                this.log,
                (channel) => {
                  if (!isWithinDeadline()) return
                  isReady = true
                  clearTimeout(timer)
                  resolve(channel)
                },
              )
            })
          })
          .catch((error: unknown) => {
            this.log.error(`Devices resolve failed: ${failureForLog(error)}`)
            reject(new Error('blocked-or-unreachable'))
          })
      })
    } catch (error) {
      socket?.destroy()
      release()
      throw new Error('blocked-or-unreachable', { cause: error })
    } finally {
      clearTimeout(timer)
      if (cancel !== undefined) this.pending.delete(cancel)
    }
  }

  revoke(pairId: string): void {
    const server = this.listeners.get(pairId)
    this.listeners.delete(pairId)
    server?.close()
    for (const [cancel, owner] of this.pending) if (owner === pairId) cancel()
    for (const [socket, owner] of this.sockets) if (owner === pairId) socket.destroy()
  }
}
