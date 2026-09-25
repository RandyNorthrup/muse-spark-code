// A fake Muse Voice Transcribe realtime endpoint for the unit tests (M35): a
// loopback HTTP server that accepts one WebSocket upgrade (RFC 6455, just
// enough of it: the handshake, unfragmented text, binary and close frames
// from the client, text and close frames back). Node's own WebSocket client
// talks to it exactly as it would to Meta.

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

const HANDSHAKE_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const OPCODE_TEXT = 0x1
const OPCODE_BINARY = 0x2
const OPCODE_CLOSE = 0x8
const FIN = 0x80
const MASKED = 0x80
const LENGTH_16 = 126
const LENGTH_64 = 127
const NORMAL_CLOSE = 1000

export interface VoiceServerConnection {
  /** What the client sent, in order: text frames as strings, binary as bytes. */
  readonly received: (string | Buffer)[]
  /** The `sessionId` query parameter and path the client asked for. */
  readonly url: string
  sendText(payload: unknown): void
  close(code: number, reason?: string): void
}

export interface FakeVoiceServer {
  readonly url: string
  /** Resolves with the first connection. */
  readonly connection: Promise<VoiceServerConnection>
  stop(): Promise<void>
}

function frame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length
  if (length < LENGTH_16) {
    return Buffer.concat([Buffer.from([FIN | opcode, length]), payload])
  }
  const header = Buffer.alloc(4)
  header.writeUInt8(FIN | opcode, 0)
  header.writeUInt8(LENGTH_16, 1)
  header.writeUInt16BE(length, 2)
  return Buffer.concat([header, payload])
}

/** Reads the client's masked frames out of a byte stream. */
class FrameReader {
  private pending = Buffer.alloc(0)

  public push(chunk: Buffer): { opcode: number; payload: Buffer }[] {
    this.pending = Buffer.concat([this.pending, chunk])
    const frames: { opcode: number; payload: Buffer }[] = []
    for (;;) {
      if (this.pending.length < 2) {
        return frames
      }
      const opcode = (this.pending[0] ?? 0) & 0x0f
      const second = this.pending[1] ?? 0
      let length = second & ~MASKED
      let offset = 2
      if (length === LENGTH_16) {
        if (this.pending.length < 4) {
          return frames
        }
        length = this.pending.readUInt16BE(2)
        offset = 4
      } else if (length === LENGTH_64) {
        if (this.pending.length < 10) {
          return frames
        }
        length = Number(this.pending.readBigUInt64BE(2))
        offset = 10
      }
      const isMasked = (second & MASKED) !== 0
      const maskLength = isMasked ? 4 : 0
      if (this.pending.length < offset + maskLength + length) {
        return frames
      }
      const mask = this.pending.subarray(offset, offset + maskLength)
      const payload = Buffer.from(
        this.pending.subarray(offset + maskLength, offset + maskLength + length),
      )
      if (isMasked) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0)
        }
      }
      this.pending = this.pending.subarray(offset + maskLength + length)
      frames.push({ opcode, payload })
    }
  }
}

export async function startFakeVoiceServer(
  onFrame: (connection: VoiceServerConnection, frame: string | Buffer) => void,
): Promise<FakeVoiceServer> {
  const sockets = new Set<Socket>()
  const ready = Promise.withResolvers<VoiceServerConnection>()
  const server = createServer((_request, response) => {
    response.writeHead(426).end()
  })
  server.on('upgrade', (request: IncomingMessage, socket: Socket) => {
    sockets.add(socket)
    const key = String(request.headers['sec-websocket-key'])
    const accept = createHash('sha1').update(`${key}${HANDSHAKE_GUID}`).digest('base64')
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n'),
    )
    let isClosed = false
    const connection: VoiceServerConnection = {
      received: [],
      url: request.url ?? '',
      sendText: (payload) => {
        socket.write(frame(OPCODE_TEXT, Buffer.from(JSON.stringify(payload))))
      },
      close: (code, reason = '') => {
        if (isClosed) {
          return
        }
        isClosed = true
        const body = Buffer.alloc(2)
        body.writeUInt16BE(code, 0)
        socket.write(frame(OPCODE_CLOSE, Buffer.concat([body, Buffer.from(reason)])))
        socket.end()
      },
    }
    const handle = (opcode: number, payload: Buffer) => {
      switch (opcode) {
        case OPCODE_TEXT: {
          const text = payload.toString('utf8')
          connection.received.push(text)
          onFrame(connection, text)
          break
        }
        case OPCODE_BINARY: {
          connection.received.push(payload)
          onFrame(connection, payload)
          break
        }
        case OPCODE_CLOSE: {
          connection.close(payload.length >= 2 ? payload.readUInt16BE(0) : NORMAL_CLOSE)
          break
        }
      }
    }
    const reader = new FrameReader()
    socket.on('data', (chunk: Buffer) => {
      for (const { opcode, payload } of reader.push(chunk)) {
        handle(opcode, payload)
      }
    })
    socket.on('error', () => undefined)
    ready.resolve(connection)
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  return {
    url: `ws://127.0.0.1:${String(port)}/v1/asr/realtime`,
    connection: ready.promise,
    stop: async () => {
      for (const socket of sockets) {
        socket.destroy()
      }
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
    },
  }
}
