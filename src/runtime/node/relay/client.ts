// `node relay`'s client half (M110d lane X1, D90.8): a node registers and
// exchanges sealed envelopes through the relay. Registration resolves when
// the relay answers and refuses on close, error or refusal; there is no
// timer of ours. Frames the relay sends are parsed before use (rule 7).
import { createConnection, type Socket } from 'node:net'
import {
  RelayFrameReader,
  encodeRelayFrame,
  relayServerFrameSchema,
  type RelayClientFrame,
  type RelayServerFrame,
} from './protocol'

export interface NodeRelayConnection {
  send(frame: RelayClientFrame): void
  onFrame(handler: (frame: RelayServerFrame) => void): void
  onClose(handler: (reason: string) => void): void
  close(): Promise<void>
}

export function connectNodeRelay(options: {
  readonly host: string
  readonly port: number
  readonly nodeId: string
  readonly maxFrameBytes: number
}): Promise<NodeRelayConnection> {
  return new Promise((resolve, reject) => {
    const reader = new RelayFrameReader(options.maxFrameBytes)
    const socket: Socket = createConnection({ host: options.host, port: options.port })
    const frameHandlers = new Set<(frame: RelayServerFrame) => void>()
    const closeHandlers = new Set<(reason: string) => void>()
    let isRegistered = false
    let isRejected = false
    let closeReason = 'closed'

    const rejectRegistration = (reason: string): void => {
      if (isRegistered || isRejected) return
      isRejected = true
      reject(new Error(reason))
    }

    const dispatchFrame = (frame: RelayServerFrame): void => {
      if (frame.t === 'registered') return
      for (const handler of frameHandlers) handler(frame)
    }

    const connection: NodeRelayConnection = {
      send(frame: RelayClientFrame): void {
        if (!socket.destroyed) socket.write(encodeRelayFrame(frame))
      },
      onFrame(handler: (frame: RelayServerFrame) => void): void {
        frameHandlers.add(handler)
      },
      onClose(handler: (reason: string) => void): void {
        closeHandlers.add(handler)
      },
      close: () =>
        new Promise((done) => {
          if (socket.destroyed) {
            done()
            return
          }
          socket.once('close', () => {
            done()
          })
          socket.end()
        }),
    }

    const fail = (reason: string): void => {
      closeReason = reason
      socket.destroy()
      rejectRegistration(reason)
    }
    socket.on('error', () => {
      fail('relay connection failed')
    })
    socket.on('close', () => {
      for (const handler of closeHandlers) handler(closeReason)
      rejectRegistration(closeReason)
    })
    socket.on('connect', () => {
      socket.write(encodeRelayFrame({ t: 'register', nodeId: options.nodeId }))
    })
    socket.on('data', (chunk: Buffer) => {
      const read = reader.push(chunk)
      if (!read.ok) {
        fail(
          read.problem === 'oversize'
            ? 'relay frame exceeds the ceiling'
            : 'relay frame is garbled',
        )
        return
      }
      const parsed = read.frames.map((raw) => relayServerFrameSchema.safeParse(raw))
      if (parsed.some((result) => !result.success)) {
        fail('relay frame is garbled')
        return
      }
      const frames = parsed.flatMap((result) => (result.success ? [result.data] : []))
      if (!isRegistered) {
        const [answer, ...rest] = frames
        if (answer === undefined) return
        if (answer.t === 'registered' && answer.nodeId === options.nodeId) {
          isRegistered = true
          resolve(connection)
        } else {
          fail(answer.t === 'refused' ? answer.reason : 'relay refused registration')
          return
        }
        for (const frame of rest) dispatchFrame(frame)
        return
      }
      for (const frame of frames) dispatchFrame(frame)
    })
  })
}
