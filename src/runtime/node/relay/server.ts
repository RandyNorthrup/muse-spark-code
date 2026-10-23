// `node relay`'s server half (M110d lane X1, D90.8): it forwards opaque
// sealed envelopes between registered nodes. It counts every connection
// and byte before registration, and refuses only under the operator's own
// ceilings, never a default of ours. A memory dump of this process holds
// routing ids, never plaintext: the sealed payload is never inspected.
import { createServer, type Server, type Socket } from 'node:net'
import {
  RelayFrameReader,
  encodeRelayFrame,
  relayClientFrameSchema,
  type RelayServerFrame,
} from './protocol'

export interface NodeRelayCeilings {
  readonly maxConnections?: number
  readonly maxBytesPerConnection?: number
}

export interface NodeRelayStats {
  readonly connections: number
  readonly rejectedConnections: number
  readonly forwarded: number
  readonly bytes: number
}

export interface StartedNodeRelay {
  readonly port: number
  stats(): NodeRelayStats
  close(): Promise<void>
}

interface TrackedConnection {
  readonly socket: Socket
  readonly reader: RelayFrameReader
  nodeId: string | undefined
  bytes: number
  closing: boolean
}

function sendFrame(socket: Socket, frame: RelayServerFrame): void {
  if (!socket.destroyed) socket.write(encodeRelayFrame(frame))
}

export function startNodeRelay(options: {
  readonly host?: string
  readonly port?: number
  readonly maxFrameBytes: number
  readonly ceilings?: NodeRelayCeilings
}): Promise<StartedNodeRelay> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer()
    const connections = new Set<TrackedConnection>()
    const byNodeId = new Map<string, TrackedConnection>()
    let connectionsSeen = 0
    let rejected = 0
    let forwarded = 0
    let bytesSeen = 0
    let isSettled = false

    const forget = (tracked: TrackedConnection): void => {
      connections.delete(tracked)
      if (tracked.nodeId !== undefined && byNodeId.get(tracked.nodeId) === tracked)
        byNodeId.delete(tracked.nodeId)
    }

    /* Refuse with the reason delivered: the frame flushes, then the wire
     * closes. Every refusal counts, whatever its cause. */
    const refuse = (tracked: TrackedConnection, reason: string): void => {
      if (tracked.closing || tracked.socket.destroyed) return
      tracked.closing = true
      rejected += 1
      tracked.socket.end(encodeRelayFrame({ t: 'refused', reason }))
    }

    server.on('connection', (socket: Socket) => {
      connectionsSeen += 1
      socket.setKeepAlive(true)
      const tracked: TrackedConnection = {
        socket,
        reader: new RelayFrameReader(options.maxFrameBytes),
        nodeId: undefined,
        bytes: 0,
        closing: false,
      }
      connections.add(tracked)
      socket.on('error', () => {
        forget(tracked)
      })
      socket.on('close', () => {
        forget(tracked)
      })
      socket.on('data', (chunk: Buffer) => {
        tracked.bytes += chunk.length
        bytesSeen += chunk.length
        if (tracked.closing) return
        const byteCeiling = options.ceilings?.maxBytesPerConnection
        if (byteCeiling !== undefined && tracked.bytes > byteCeiling) {
          refuse(tracked, 'connection exceeds the relay ceiling')
          return
        }
        const read = tracked.reader.push(chunk)
        if (!read.ok) {
          refuse(
            tracked,
            read.problem === 'oversize' ? 'frame exceeds the relay ceiling' : 'unparseable frame',
          )
          return
        }
        for (const raw of read.frames) {
          const parsed = relayClientFrameSchema.safeParse(raw)
          if (!parsed.success) {
            refuse(tracked, 'unparseable frame')
            return
          }
          const frame = parsed.data
          if (frame.t === 'close') {
            socket.destroy()
            return
          }
          if (frame.t === 'register') {
            const held = byNodeId.get(frame.nodeId)
            if (held !== tracked && held !== undefined && !held.socket.destroyed) {
              refuse(tracked, 'node is already on this relay')
              return
            }
            if (
              tracked.nodeId !== undefined &&
              tracked.nodeId !== frame.nodeId &&
              byNodeId.get(tracked.nodeId) === tracked
            )
              byNodeId.delete(tracked.nodeId)
            tracked.nodeId = frame.nodeId
            byNodeId.set(frame.nodeId, tracked)
            sendFrame(socket, { t: 'registered', nodeId: frame.nodeId })
          } else if (tracked.nodeId === undefined) {
            refuse(tracked, 'register first')
            return
          } else {
            const target = byNodeId.get(frame.to)
            if (target === undefined || target.closing || target.socket.destroyed) {
              sendFrame(socket, {
                t: 'unreachable',
                to: frame.to,
                reason: 'node is not on this relay',
              })
            } else {
              forwarded += 1
              sendFrame(target.socket, {
                t: 'deliver',
                from: tracked.nodeId,
                sealed: frame.sealed,
                sequence: frame.sequence,
              })
            }
          }
        }
      })
      // Every socket is tracked and drained from accept, including refused
      // ones: an undrained socket wedges the server's own close.
      const ceiling = options.ceilings?.maxConnections
      if (ceiling !== undefined && connections.size > ceiling) refuse(tracked, 'relay is full')
    })
    server.on('error', (error: Error) => {
      if (isSettled) return
      isSettled = true
      reject(error)
    })
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      if (isSettled) return
      isSettled = true
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({
        port,
        stats: () => ({
          connections: connectionsSeen,
          rejectedConnections: rejected,
          forwarded,
          bytes: bytesSeen,
        }),
        close: () =>
          new Promise((done) => {
            for (const tracked of connections) tracked.socket.destroy()
            server.close(() => {
              done()
            })
          }),
      })
    })
  })
}
