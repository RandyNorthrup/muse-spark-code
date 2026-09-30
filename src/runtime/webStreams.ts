// A Node stream as the web `ReadableStream` the ACP SDK reads (PLAN.md D62).
// Node's own `Readable.toWeb` is typed as `stream/web`'s class, not the
// global one the SDK takes. The SDK cancels the stream when its connection
// closes, after which the source's end must not close it again: once the
// stream is done, or cancelled, the source is let go.

import type { Readable } from 'node:stream'

export function webReadable(source: Readable): ReadableStream<Uint8Array> {
  let isDone = false
  const listeners: { onData?: (chunk: Buffer) => void } = {}
  const release = () => {
    isDone = true
    if (listeners.onData !== undefined) {
      source.off('data', listeners.onData)
    }
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      listeners.onData = (chunk) => {
        controller.enqueue(chunk)
      }
      source.on('data', listeners.onData)
      source.once('end', () => {
        if (isDone) {
          return
        }
        release()
        controller.close()
      })
      source.once('error', (error) => {
        if (isDone) {
          return
        }
        release()
        controller.error(error)
      })
    },
    cancel() {
      release()
      source.pause()
    },
  })
}
