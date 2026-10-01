// The DevTools protocol over `--remote-debugging-pipe` (M81, PLAN.md D49):
// the browser reads file descriptor 3 and writes file descriptor 4, each
// message one JSON text ended by a NUL byte, so no debugging port exists.
// Every message is checked with a schema before use (AGENTS.md rule 7). A
// call is matched to its answer by id; an event goes to the listeners with
// the session it came from (`Target.attachToTarget` with `flatten`), none
// for the browser's own. A message larger than the bound ends the
// connection. Pure: the two pipe ends are injected.

import { Buffer } from 'node:buffer'
import * as z from 'zod/mini'
import { BROWSER_CHECK_MESSAGE_MAX_BYTES } from '../../shared/constants'

/** The parent's end of file descriptor 3. */
export interface PipeWriter {
  write(chunk: string): boolean
}

/** The parent's end of file descriptor 4. */
export interface PipeReader {
  on(event: 'data', listener: (chunk: Uint8Array) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close', listener: () => void): unknown
}

export interface CdpEvent {
  readonly method: string
  readonly params: unknown
  /** The flattened session the event belongs to; undefined for the browser's own. */
  readonly sessionId: string | undefined
}

const messageSchema = z.object({
  id: z.optional(z.number()),
  result: z.optional(z.unknown()),
  error: z.optional(z.object({ message: z.optional(z.string()) })),
  method: z.optional(z.string()),
  params: z.optional(z.unknown()),
  sessionId: z.optional(z.string()),
})
type CdpMessage = z.infer<typeof messageSchema>

const NUL = 0

function stillClosed(): void {
  // A listener told of an end that had already happened has nothing to stop.
}

/** The browser refused a call, or the connection ended. */
export class CdpError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'CdpError'
  }
}

export class CdpConnection {
  private nextId = 1
  private readonly pending = new Map<number, (message: CdpMessage) => void>()
  private readonly eventListeners = new Set<(event: CdpEvent) => void>()
  private readonly closeListeners = new Set<(reason: Error) => void>()
  private parts: Buffer[] = []
  private partBytes = 0
  private closeReason: Error | undefined

  public constructor(
    private readonly writer: PipeWriter,
    reader: PipeReader,
    private readonly maxMessageBytes: number = BROWSER_CHECK_MESSAGE_MAX_BYTES,
  ) {
    reader.on('data', (chunk) => {
      this.receive(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
    })
    // A browser that could not start reports why through the pipe's error.
    reader.on('error', (error) => {
      this.close(new CdpError(error.message))
    })
    reader.on('close', () => {
      this.close(new CdpError('the browser closed the debugging pipe'))
    })
  }

  private receive(chunk: Buffer): void {
    let rest = chunk
    let end = rest.indexOf(NUL)
    while (end !== -1 && this.closeReason === undefined) {
      const frame = Buffer.concat([...this.parts, rest.subarray(0, end)])
      this.parts = []
      this.partBytes = 0
      rest = rest.subarray(end + 1)
      this.route(frame.toString('utf8'))
      end = rest.indexOf(NUL)
    }
    if (rest.length === 0 || this.closeReason !== undefined) {
      return
    }
    this.partBytes += rest.length
    if (this.partBytes > this.maxMessageBytes) {
      this.close(new CdpError('the browser sent a message larger than the check accepts'))
      return
    }
    this.parts.push(rest)
  }

  private route(frame: string): void {
    let raw: unknown
    try {
      raw = JSON.parse(frame)
    } catch {
      // Chrome sends JSON on the pipe; anything else is not a message.
      return
    }
    const parsed = messageSchema.safeParse(raw)
    if (!parsed.success) {
      return
    }
    const message = parsed.data
    if (message.id !== undefined) {
      const settle = this.pending.get(message.id)
      this.pending.delete(message.id)
      settle?.(message)
      return
    }
    if (message.method === undefined) {
      return
    }
    const event: CdpEvent = {
      method: message.method,
      params: message.params,
      sessionId: message.sessionId,
    }
    for (const listener of this.eventListeners) {
      listener(event)
    }
  }

  /** Why the connection ended; undefined while it is open. */
  public get closedBy(): Error | undefined {
    return this.closeReason
  }

  /** Every event from now on; the answer stops them. */
  public onEvent(listener: (event: CdpEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  /** Told once, when the connection ends; at once when it has ended already. */
  public onClose(listener: (reason: Error) => void): () => void {
    if (this.closeReason !== undefined) {
      listener(this.closeReason)
      return stillClosed
    }
    this.closeListeners.add(listener)
    return () => {
      this.closeListeners.delete(listener)
    }
  }

  /** One call: its `result`, or a rejection when the browser answers an error or the connection ends. */
  public send(
    method: string,
    params: Readonly<Record<string, unknown>> = {},
    sessionId?: string,
  ): Promise<unknown> {
    if (this.closeReason !== undefined) {
      return Promise.reject(this.closeReason)
    }
    const id = this.nextId
    this.nextId += 1
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, (message) => {
        if (message.error === undefined) {
          resolve(message.result)
          return
        }
        reject(new CdpError(message.error.message ?? `${method} failed`))
      })
      try {
        this.writer.write(
          `${JSON.stringify({ id, method, params, ...(sessionId !== undefined && { sessionId }) })}\0`,
        )
      } catch (error: unknown) {
        this.pending.delete(id)
        reject(new CdpError(error instanceof Error ? error.message : String(error)))
      }
    })
  }

  /** Ends the connection: every waiting call is rejected with `reason`. */
  public close(reason: Error): void {
    if (this.closeReason !== undefined) {
      return
    }
    this.closeReason = reason
    for (const settle of this.pending.values()) {
      settle({ error: { message: reason.message } })
    }
    this.pending.clear()
    this.eventListeners.clear()
    for (const listener of this.closeListeners) {
      listener(reason)
    }
    this.closeListeners.clear()
  }
}
