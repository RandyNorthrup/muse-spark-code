// M124 (D106): MCP's stdio transport. Newline-delimited JSON-RPC: one
// message per line on stdin, one reply per line on stdout, nothing else on
// stdout (diagnostics go to stderr through the runtime logger). A line over
// the frame bound is refused before it is parsed and discarded up to its end.
// Calls run concurrently, so a cancellation can reach a call in flight;
// replies are written in completion order.
import type { Readable, Writable } from 'node:stream'
import { CONNECTOR_LIMITS, JSON_RPC_ERRORS } from '../../shared/constants'
import { ConnectorProtocol, type FrameReply } from '../../core/connector/protocol'

const NEWLINE = 0x0a
const CARRIAGE_RETURN = 0x0d

export interface StdioHandles {
  readonly input: Readable
  readonly output: Writable
}

/** Splits bytes into lines, never holding more than one bounded frame. */
class LineFramer {
  private buffered: Buffer[] = []
  private size = 0
  private isDiscarding = false

  public constructor(
    private readonly maxFrameBytes: number,
    private readonly onLine: (line: Buffer) => void,
    private readonly onTooLarge: () => void,
  ) {}

  private take(piece: Buffer): void {
    if (this.isDiscarding) return
    this.size += piece.length
    if (this.size <= this.maxFrameBytes) {
      this.buffered.push(piece)
      return
    }
    this.isDiscarding = true
    this.buffered = []
    this.onTooLarge()
  }

  public push(chunk: Buffer): void {
    let data = chunk
    let end = data.indexOf(NEWLINE)
    while (end !== -1) {
      this.take(data.subarray(0, end))
      if (!this.isDiscarding) {
        const line = Buffer.concat(this.buffered)
        this.onLine(line.at(-1) === CARRIAGE_RETURN ? line.subarray(0, -1) : line)
      }
      this.buffered = []
      this.size = 0
      this.isDiscarding = false
      data = data.subarray(end + 1)
      end = data.indexOf(NEWLINE)
    }
    this.take(data)
  }
}

/** Serves until stdin ends or stdout closes; resolves after the last reply is written. */
export async function serveStdio(
  handles: StdioHandles,
  protocol: Pick<ConnectorProtocol, 'handle' | 'close'>,
  maxFrameBytes: number = CONNECTOR_LIMITS.frameBytes,
): Promise<void> {
  const pending = new Set<Promise<void>>()
  const state = { isClosed: false }
  const onClose = () => {
    state.isClosed = true
  }
  handles.output.once('close', onClose)
  handles.output.once('error', onClose)
  const write = (reply: FrameReply) => {
    if (reply === undefined || state.isClosed) return
    handles.output.write(`${JSON.stringify(reply)}\n`)
  }
  const answer = async (text: string) => {
    try {
      write(await protocol.handle(text))
    } catch {
      /* The protocol answers its own failures; a write after close is dropped. */
    }
  }
  const framer = new LineFramer(
    maxFrameBytes,
    (line) => {
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(line)
      } catch {
        write({
          jsonrpc: '2.0',
          id: null,
          error: { code: JSON_RPC_ERRORS.parseError, message: 'Parse error' },
        })
        return
      }
      if (text.trim() === '') return
      const task = answer(text)
      pending.add(task)
      void task.finally(() => {
        pending.delete(task)
      })
    },
    () => {
      write(ConnectorProtocol.tooLarge())
    },
  )
  try {
    for await (const chunk of handles.input) {
      if (state.isClosed) break
      framer.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'))
    }
  } finally {
    // End of input is the client's disconnect: calls in flight stop.
    protocol.close()
    await Promise.allSettled(pending)
    handles.output.off('close', onClose)
    handles.output.off('error', onClose)
  }
}
