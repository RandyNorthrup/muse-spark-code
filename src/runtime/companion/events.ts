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
    subscribe: (emit: (message: unknown) => void) => () => void,
    encode: (message: unknown) => string,
    activity: () => void,
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
      unsubscribe = subscribe((message) => {
        if (isStopped) return
        try {
          const frame = `data: ${encode(message)}\n\n`
          if (Buffer.byteLength(frame) + response.writableLength > this.maxBytes) {
            stop()
            return
          }
          activity()
          response.write(frame)
        } catch {
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

  public close(): void {
    for (const stream of this.streams.values()) stream.stop()
  }
}
