// M124 (D106): MCP's stdio transport. Newline-delimited JSON-RPC: one
// message per line on stdin, one reply per line on stdout, nothing else on
// stdout (diagnostics go to stderr through the runtime logger). A line over
// the frame bound is refused before it is parsed and discarded up to its end.
// Calls run concurrently, so a cancellation can reach a call in flight;
// replies are written in completion order, within bounded admission. Every
// frame refused here (too large, invalid UTF-8, busy) leaves one transport
// receipt. Nothing here waits for the journal: a receipt that meets a full
// journal backlog is tallied there (audit.ts), so Stop and cancellation
// notices are never queued behind receipts.
import type { Readable, Writable } from 'node:stream'
import { CONNECTOR_LIMITS, CONNECTOR_RPC_ERRORS, JSON_RPC_ERRORS } from '../../shared/constants'
import { ConnectorProtocol, type FrameReply } from '../../core/connector/protocol'

const NEWLINE = 0x0a
const CARRIAGE_RETURN = 0x0d

export interface StdioHandles {
  readonly input: Readable
  readonly output: Writable
}

/** One line of input, or a frame that passed the bound (never kept). */
type Frame = Buffer | 'tooLarge'

/** Splits bytes into lines, never holding more than one bounded frame. */
class LineFramer {
  private buffered: Buffer[] = []
  private size = 0
  private isDiscarding = false

  public constructor(private readonly maxFrameBytes: number) {}

  private take(piece: Buffer, frames: Frame[]): void {
    if (this.isDiscarding) return
    this.size += piece.length
    if (this.size <= this.maxFrameBytes) {
      this.buffered.push(piece)
      return
    }
    this.isDiscarding = true
    this.buffered = []
    frames.push('tooLarge')
  }

  public push(chunk: Buffer): Frame[] {
    const frames: Frame[] = []
    let data = chunk
    let end = data.indexOf(NEWLINE)
    while (end !== -1) {
      this.take(data.subarray(0, end), frames)
      if (!this.isDiscarding) {
        const line = Buffer.concat(this.buffered)
        frames.push(line.at(-1) === CARRIAGE_RETURN ? line.subarray(0, -1) : line)
      }
      this.buffered = []
      this.size = 0
      this.isDiscarding = false
      data = data.subarray(end + 1)
      end = data.indexOf(NEWLINE)
    }
    this.take(data, frames)
    return frames
  }
}

/**
Serves until stdin ends or stdout closes, whichever is first: either side
closing is the client's disconnect. Work is admitted, not unbounded: at
most `transportTasks` frames at once (busy beyond that), with
`controlTasks` more kept for Stop, schedule cancel and cancellation
notices. Replies honour stdout's backpressure; a client that leaves more
than `outputQueueBytes` unread is disconnected. Resolves after the last
reply is written.
*/
export async function serveStdio(
  handles: StdioHandles,
  protocol: Pick<ConnectorProtocol, 'handle' | 'close' | 'refuse'>,
  maxFrameBytes: number = CONNECTOR_LIMITS.frameBytes,
): Promise<void> {
  const pending = new Set<Promise<void>>()
  const state = { isClosed: false, isWaiting: false, queued: 0 }
  const queue: string[] = []
  const close = () => {
    if (state.isClosed) return
    state.isClosed = true
    queue.length = 0
    protocol.close()
    handles.input.destroy()
  }
  const flush = () => {
    while (!state.isWaiting && !state.isClosed) {
      const line = queue.shift()
      if (line === undefined) return
      state.queued -= Buffer.byteLength(line)
      if (handles.output.write(line)) continue
      state.isWaiting = true
      handles.output.once('drain', () => {
        state.isWaiting = false
        flush()
      })
    }
  }
  handles.output.once('close', close)
  handles.output.once('error', close)
  const write = (reply: FrameReply) => {
    if (reply === undefined || state.isClosed) return
    const line = `${JSON.stringify(reply)}\n`
    queue.push(line)
    state.queued += Buffer.byteLength(line)
    if (state.queued > CONNECTOR_LIMITS.outputQueueBytes) close()
    else flush()
  }
  const answer = async (text: string) => {
    try {
      write(await protocol.handle(text))
    } catch {
      /* The protocol answers its own failures; a write after close is dropped. */
    }
  }
  const accept = (frame: Frame) => {
    if (frame === 'tooLarge') {
      write(protocol.refuse(CONNECTOR_RPC_ERRORS.requestTooLarge, null))
      return
    }
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(frame)
    } catch {
      write(protocol.refuse(JSON_RPC_ERRORS.parseError, null))
      return
    }
    if (text.trim() === '') return
    if (pending.size >= CONNECTOR_LIMITS.transportTasks) {
      const classified = ConnectorProtocol.classify(text)
      if (
        !classified.isControl ||
        pending.size >= CONNECTOR_LIMITS.transportTasks + CONNECTOR_LIMITS.controlTasks
      ) {
        // A notification has no id to answer; its refusal is still recorded.
        const busy = protocol.refuse(CONNECTOR_RPC_ERRORS.busy, classified.id)
        if (classified.id !== undefined) write(busy)
        return
      }
    }
    const task = answer(text)
    pending.add(task)
    void task.finally(() => {
      pending.delete(task)
    })
  }
  const framer = new LineFramer(maxFrameBytes)
  const take = (chunk: unknown) => {
    const frames = framer.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'))
    for (const frame of frames) if (!state.isClosed) accept(frame)
  }
  try {
    for await (const chunk of handles.input) {
      take(chunk)
      if (state.isClosed) break
    }
  } catch (error: unknown) {
    // Closing stdout destroys stdin to end this loop; any other failure is real.
    if (!state.isClosed) throw error
  } finally {
    // End of input is the client's disconnect: calls in flight stop.
    protocol.close()
    await Promise.allSettled(pending)
    handles.output.off('close', close)
    handles.output.off('error', close)
  }
}
