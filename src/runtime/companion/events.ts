import { Buffer } from 'node:buffer'
import type { ServerResponse } from 'node:http'
import { HTTP_STATUS, MHP_PANEL } from '../../shared/constants'

type Emit = (message: unknown, complete?: () => void) => void
interface EventWrite {
  readonly frame: string
  readonly complete: (() => void) | undefined
}

/** One ordered, bounded stream per memory bearer, with completion tied to Node's writer. */
export class CompanionEvents {
  private readonly streams = new Map<string, { response: ServerResponse; stop(): void }>()
  // The panel supplies its SSE id; the usage companion never loads MHP schemas.
  public constructor(
    private readonly maxBytes: number,
    private readonly eventId?: (message: unknown) => string | undefined,
  ) {}
  public has(id: string): boolean {
    return this.streams.has(id)
  }

  public open(
    id: string,
    response: ServerResponse,
    expiresAt: number,
    subscribe: (emit: Emit) => () => void,
    encode: (message: unknown) => string,
    activity: () => void,
  ): void {
    if (this.has(id)) throw new Error('EPANEL_STREAM')
    let unsubscribe: (() => void) | undefined
    let isStopped = false
    let isBlocked = false
    let queuedBytes = 0
    const queue: EventWrite[] = []
    const writing = new Set<EventWrite>()
    const expiry = setTimeout(
      () => {
        stop()
      },
      Math.max(1, expiresAt - Date.now()),
    )
    const stop = () => {
      if (isStopped) return
      isStopped = true
      clearTimeout(expiry)
      this.streams.delete(id)
      response.off('close', stop)
      response.off('drain', resume)
      try {
        unsubscribe?.()
      } catch {
        response.destroy()
      } finally {
        for (const pending of [...queue.splice(0), ...writing]) pending.complete?.()
        writing.clear()
        response.end()
      }
    }
    const drain = () => {
      if (isStopped || isBlocked) return
      for (;;) {
        const pending = queue.shift()
        if (pending === undefined) return
        queuedBytes -= Buffer.byteLength(pending.frame)
        writing.add(pending)
        isBlocked = !response.write(pending.frame, () => {
          writing.delete(pending)
          pending.complete?.()
        })
        if (isBlocked) return
      }
    }
    const resume = () => {
      isBlocked = false
      drain()
    }
    this.streams.set(id, { response, stop })
    response.once('close', stop)
    response.on('drain', resume)
    response.writeHead(HTTP_STATUS.ok, {
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
    })
    isBlocked = !response.write(': connected\n\n')
    try {
      unsubscribe = subscribe((message, complete) => {
        if (isStopped) {
          complete?.()
          return
        }
        try {
          const encoded = encode(message)
          const eventId = this.eventId?.(message)
          const sequence = eventId === undefined ? '' : `id: ${eventId}\n`
          const frame = `event: mhp\n${sequence}data: ${encoded}\n\n`
          if (
            Buffer.byteLength(frame) + queuedBytes + response.writableLength > this.maxBytes ||
            queue.length + writing.size + 1 > MHP_PANEL.maximumQueuedMessages
          ) {
            stop()
            complete?.()
            return
          }
          queuedBytes += Buffer.byteLength(frame)
          queue.push({ frame, complete })
          activity()
          drain()
        } catch {
          stop()
          complete?.()
        }
      })
      // Synchronous initial emissions can close before subscribe returned.
      if (!this.has(id)) unsubscribe()
    } catch (error: unknown) {
      stop()
      throw error
    }
  }

  public retire(id: string): void {
    this.streams.get(id)?.stop()
  }

  public close(): void {
    for (const stream of this.streams.values()) stream.stop()
  }
}
