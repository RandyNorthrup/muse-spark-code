import { Buffer } from 'node:buffer'
import type { ServerResponse } from 'node:http'
import { HTTP_STATUS } from '../../shared/constants'

/** One bounded stream per bearer session. Slow readers disconnect rather than queue unbounded events. */
export class CompanionEvents {
  private readonly streams = new Map<string, { response: ServerResponse; stop(): void }>()

  public constructor(private readonly maxBytes: number) {}

  public has(id: string): boolean {
    return this.streams.has(id)
  }

  public open(
    id: string,
    response: ServerResponse,
    expiresAt: number,
    subscribe: (emit: (message: unknown, complete?: () => void) => void) => () => void,
    encode: (message: unknown) => string,
    activity: () => void,
    report?: (error: unknown) => void,
  ): void {
    if (this.has(id)) throw new Error('EPANEL_STREAM')
    let unsubscribe: (() => void) | undefined
    let isStopped = false
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
      try {
        unsubscribe?.()
      } catch {
        response.destroy()
      } finally {
        response.end()
      }
    }
    this.streams.set(id, { response, stop })
    response.once('close', stop)
    response.writeHead(HTTP_STATUS.ok, {
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
    })
    response.write(': connected\n\n')
    try {
      unsubscribe = subscribe((message, complete) => {
        if (isStopped) {
          complete?.()
          return
        }
        try {
          const frame = `data: ${encode(message)}\n\n`
          if (Buffer.byteLength(frame) + response.writableLength > this.maxBytes) {
            complete?.()
            stop()
            return
          }
          activity()
          // Completion is tied to Node's writer: the panel's delivery
          // holds its budget until the frame is flushed or the stream dies.
          response.write(frame, () => {
            complete?.()
          })
        } catch (error: unknown) {
          // REPORTED: a frame the owner's schema refuses, or a stream that
          // died mid-write, ends the stream; the owner records the cause.
          complete?.()
          report?.(error)
          stop()
        }
      })
      // A synchronous initial emission may have closed the stream before subscribe returned.
      if (!this.has(id)) unsubscribe()
    } catch (error) {
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
