// Real pinned-TLS 1.3 sockets for the device suites: a listener and a
// dialer that pin each other's invitation certificate, no resumption.
// Shared by the paced-channel, owner-binding and two-process suites so the
// pin check lives once. No test runner import: the e2e drivers bundle this.
import { constants, createHash } from 'node:crypto'
import { connect, createServer, type Server, type TLSSocket } from 'node:tls'
import type {
  DeviceChannelDialer,
  DeviceChannelPeer,
} from '../../../src/host/devices/deviceChannel'
import { DEVICE_LIMITS } from '../../../src/shared/constants'
import { deviceReadySchema, type DeviceReady } from '../../../src/shared/devices'
import type { DeviceTlsIdentity } from './deviceTls'

export function pacedReadyFor(
  pairId: string,
  incarnationId: string,
  requestId: string,
): DeviceReady {
  return deviceReadySchema.parse({
    version: DEVICE_LIMITS.protocolVersion,
    pairId,
    receiverIncarnationId: incarnationId,
    requestId,
    // The multiplexed core requires every stream, never a subset.
    streams: ['control', 'status', 'events', 'logs', 'bulk'],
  })
}

export function isPinnedFingerprint(raw: unknown, peer: DeviceTlsIdentity): boolean {
  return Buffer.isBuffer(raw) && createHash('sha256').update(raw).digest('hex') === peer.fingerprint
}

export function pinnedServer(local: DeviceTlsIdentity, peer: DeviceTlsIdentity): Server {
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

export function pinnedConnect(
  local: DeviceTlsIdentity,
  peer: DeviceTlsIdentity,
  port: number,
): Promise<TLSSocket> {
  return new Promise<TLSSocket>((resolve, reject) => {
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
      checkServerIdentity: (_hostname, certificate) =>
        isPinnedFingerprint(certificate.raw, peer) ? undefined : new Error('unpaired'),
    })
    socket.once('secureConnect', () => {
      resolve(socket)
    })
    socket.once('error', (error: Error) => {
      reject(error)
    })
  })
}

export function pinnedDialer(
  local: DeviceTlsIdentity,
  peer: DeviceTlsIdentity,
  port: number,
  dials: string[] = [],
): DeviceChannelDialer {
  return {
    dial: async (target: DeviceChannelPeer, signal: AbortSignal): Promise<TLSSocket> => {
      dials.push(target.pairId)
      // The signal can abort during the await below; only a fresh read sees it.
      const isAborted = (): boolean => signal.aborted
      if (isAborted()) throw new Error('revoked')
      const socket = await pinnedConnect(local, peer, port)
      if (isAborted()) {
        socket.destroy()
        throw new Error('revoked')
      }
      return socket
    },
  }
}

export async function closePacedServers(servers: Server[]): Promise<void> {
  for (const server of servers.splice(0)) {
    server.close()
    await new Promise((resolve) => server.once('close', resolve))
  }
}

export async function listenEphemeral(server: Server): Promise<number> {
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
