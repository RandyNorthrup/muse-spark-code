// Async libuv writes keep deadline/signal timers running even on a blocked pipe.
import { write } from 'node:fs'
import { EXEC_SINK_HIGH_WATER_BYTES, EXEC_WRITE_RETRY_MS } from '../../shared/constants'

// A full non-blocking pipe (Node's own child stdio, a runner's log pipe)
// answers EAGAIN: its reader is slow, not gone. The write is retried on a
// timer; flush deadlines and the high-water mark still bound the wait.
const RETRY_CODES = new Set(['EAGAIN', 'EWOULDBLOCK'])

export interface FdWriter {
  write(chunk: string): void
  readonly queuedBytes: number
  readonly isClosed: boolean
  flush(withinMs: number): Promise<boolean>
}

export function createFdWriter(fd: number, onClosed: () => void): FdWriter {
  const queue: Buffer[] = []
  const waiters = new Set<() => void>()
  let queuedBytes = 0
  let isClosed = false
  let isWriting = false
  let retry: ReturnType<typeof setTimeout> | undefined
  let offset = 0
  const notify = () => {
    for (const waiter of waiters) waiter()
  }
  const close = () => {
    if (isClosed) return
    isClosed = true
    clearTimeout(retry)
    retry = undefined
    queue.length = 0
    queuedBytes = 0
    notify()
    onClosed()
  }
  const pump = () => {
    const buffer = queue[0]
    if (isClosed || isWriting || retry !== undefined || buffer === undefined) return
    isWriting = true
    try {
      write(fd, buffer, offset, buffer.length - offset, null, (error, written) => {
        isWriting = false
        if (isClosed) return
        if (error !== null && RETRY_CODES.has(error.code ?? '')) {
          retry = setTimeout(() => {
            retry = undefined
            pump()
          }, EXEC_WRITE_RETRY_MS)
          return
        }
        if (error !== null || written <= 0) {
          close()
          return
        }
        offset += written
        queuedBytes -= written
        if (offset === buffer.length) {
          queue.shift()
          offset = 0
        }
        if (queuedBytes === 0) notify()
        pump()
      })
    } catch {
      // A synchronously invalid fd has the same one-shot closure as EBADF.
      isWriting = false
      close()
    }
  }
  return {
    write(chunk) {
      if (isClosed || chunk === '') return
      const buffer = Buffer.from(chunk)
      if (buffer.length > EXEC_SINK_HIGH_WATER_BYTES - queuedBytes) {
        close()
        return
      }
      queuedBytes += buffer.length
      queue.push(buffer)
      pump()
    },
    get queuedBytes() {
      return queuedBytes
    },
    get isClosed() {
      return isClosed
    },
    flush(withinMs) {
      if (isClosed || queuedBytes === 0) return Promise.resolve(!isClosed)
      return new Promise((resolve) => {
        const settled = () => {
          if (!isClosed && queuedBytes !== 0) return
          clearTimeout(timer)
          waiters.delete(settled)
          resolve(!isClosed)
        }
        const timer = setTimeout(
          () => {
            waiters.delete(settled)
            resolve(false)
          },
          Math.max(0, withinMs),
        )
        waiters.add(settled)
      })
    },
  }
}
