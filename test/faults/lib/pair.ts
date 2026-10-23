// The rig's heartbeat pair (M110r Y4): a node end and an orchestrator
// end exchanging real heartbeat frames over a real TCP connection, each
// tracked by a real LivenessTracker. The node keeps its sequence counter
// across reconnects; the orchestrator asserts continuity (no dupes, no
// loss it cannot see) and measures the rediscovery time.
import { connect, createServer, type Server, type Socket } from 'node:net'
import type { LivenessTracker } from '../../../src/core/devices/liveness'

export interface Heartbeat {
  readonly from: string
  readonly seq: number
  readonly wall: number
  /** The sender's current addresses, when it re-announces them (dial-home). */
  readonly addresses?: readonly string[]
}

export function encodeHeartbeat(beat: Heartbeat): string {
  return `${JSON.stringify(beat)}\n`
}

export function decodeHeartbeat(line: string): Heartbeat {
  const parsed: unknown = JSON.parse(line)
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('from' in parsed) ||
    !('seq' in parsed) ||
    !('wall' in parsed) ||
    typeof parsed.from !== 'string' ||
    typeof parsed.seq !== 'number' ||
    typeof parsed.wall !== 'number'
  ) {
    throw new TypeError(`malformed heartbeat frame: ${line}`)
  }
  let addresses: readonly string[] | undefined
  if ('addresses' in parsed && parsed.addresses !== undefined) {
    if (!Array.isArray(parsed.addresses)) throw new TypeError(`malformed heartbeat frame: ${line}`)
    const list: string[] = []
    for (const address of parsed.addresses) {
      if (typeof address !== 'string') throw new TypeError(`malformed heartbeat frame: ${line}`)
      list.push(address)
    }
    addresses = list
  }
  return addresses === undefined
    ? { from: parsed.from, seq: parsed.seq, wall: parsed.wall }
    : { from: parsed.from, seq: parsed.seq, wall: parsed.wall, addresses }
}

/** One end's live connection: its socket, tracker, and sequence ledger. */
export interface PairEnd {
  readonly label: string
  readonly tracker: LivenessTracker
  readonly seenSeqs: number[]
  /** Socket failures the end recorded (resets and refused dials). */
  readonly errors: unknown[]
  send(beat: Heartbeat): void
  close(): void
}

interface LineConnectionOptions {
  readonly label: string
  readonly tracker: LivenessTracker
  readonly onBeat?: ((beat: Heartbeat) => void) | undefined
}

function lineConnection(socket: Socket, options: LineConnectionOptions): PairEnd {
  const seenSeqs: number[] = []
  const errors: unknown[] = []
  let buffered = ''
  socket.setEncoding('utf8')
  socket.on('error', (error: unknown) => {
    errors.push(error)
  })
  socket.on('data', (chunk: string) => {
    buffered += chunk
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    for (const line of lines) {
      if (line === '') continue
      const beat = decodeHeartbeat(line)
      seenSeqs.push(beat.seq)
      options.onBeat?.(beat)
    }
  })
  return {
    label: options.label,
    tracker: options.tracker,
    seenSeqs,
    errors,
    send: (beat: Heartbeat) => {
      socket.write(encodeHeartbeat(beat))
    },
    close: () => {
      socket.destroy()
    },
  }
}

/** Listen on an address; resolves with the server and its port. */
export async function listenOn(host: string): Promise<{ server: Server; port: number }> {
  const server = createServer()
  await new Promise<void>((resolve) => {
    server.listen(0, host, resolve)
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) {
    throw new Error('pair listener has no port')
  }
  return { server, port: address.port }
}

/** Accept one connection and wrap it as a pair end. */
export function acceptOne(server: Server, options: LineConnectionOptions): Promise<PairEnd> {
  return new Promise<PairEnd>((resolve) => {
    server.once('connection', (socket: Socket) => {
      resolve(lineConnection(socket, options))
    })
  })
}

/** Dial a pair end and wrap the socket. */
export function dialEnd(
  host: string,
  port: number,
  options: LineConnectionOptions,
): Promise<PairEnd> {
  return new Promise<PairEnd>((resolve, reject) => {
    const socket = connect(port, host)
    socket.once('connect', () => {
      resolve(lineConnection(socket, options))
    })
    socket.once('error', (error: unknown) => {
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

/** Close a listener, waiting for it to release the port. */
export async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error === undefined) resolve(undefined)
      else reject(error)
    })
  })
}
