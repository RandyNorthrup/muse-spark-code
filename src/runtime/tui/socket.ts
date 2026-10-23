import { lstat } from 'node:fs/promises'
import { createConnection } from 'node:net'
import path from 'node:path'
import { TUI_LIMITS, UI_TEXT } from '../../shared/constants'
import {
  tuiActionSchema,
  tuiEventSchema,
  type TuiConnection,
  type TuiEvent,
  type TuiWireBinding,
} from './protocol'

/** Refuse a network address, link, other owner, or group/world-readable socket. */
export async function checkTuiSocket(socketPath: string, uid: number | undefined): Promise<void> {
  if (uid === undefined || !path.isAbsolute(socketPath)) throw new Error(UI_TEXT.tuiUnsafeSocket)
  const parent = await lstat(path.dirname(socketPath))
  const socket = await lstat(socketPath)
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    parent.uid !== uid ||
    (parent.mode & TUI_LIMITS.permissionMask) !== 0 ||
    !socket.isSocket() ||
    socket.isSymbolicLink() ||
    socket.uid !== uid ||
    (socket.mode & TUI_LIMITS.permissionMask) !== 0
  ) {
    throw new Error(UI_TEXT.tuiUnsafeSocket)
  }
}

// Malformed peer bytes end the connection as invalid; binding failures report.
// A decoder TypeError is conservatively treated as peer garbage: decoders
// throw it for bad bytes, and an adapter bug throwing it stays silent. The
// loop's own bound throw carries the invalid-frame sentence.
function isExpectedFrameError(error: unknown): boolean {
  return (
    error instanceof SyntaxError ||
    error instanceof TypeError ||
    (error instanceof Error && error.name === 'ZodError') ||
    (error instanceof Error && error.message === UI_TEXT.tuiInvalidFrame)
  )
}

/** JSONL is framing only; the required binding owns every MHP payload schema. */
export async function connectTuiSocket(options: {
  socketPath: string
  uid: number | undefined
  binding: TuiWireBinding
  receive: (event: TuiEvent) => void
  signal: AbortSignal
  report(error: unknown): void
}): Promise<TuiConnection> {
  options.signal.throwIfAborted()
  await checkTuiSocket(options.socketPath, options.uid)
  options.signal.throwIfAborted()
  return await new Promise<TuiConnection>((resolve, reject) => {
    const socket = createConnection({ path: options.socketPath })
    let buffer = Buffer.alloc(0)
    let isConnected = false
    let isEnded = false
    let finish: ((error: Error | undefined) => void) | undefined
    const closed = new Promise<void>((resolveClosed, rejectClosed) => {
      finish = (error) => {
        if (error === undefined) resolveClosed()
        else rejectClosed(error)
      }
    })
    const cleanup = () => {
      clearTimeout(timer)
      options.signal.removeEventListener('abort', abort)
    }
    const end = (error?: Error) => {
      if (isEnded) return
      isEnded = true
      cleanup()
      buffer = Buffer.alloc(0)
      socket.destroy()
      if (!isConnected) reject(error ?? new Error(UI_TEXT.tuiDisconnected))
      // Nobody holds closed before a connection is returned, so a connect
      // failure settles it instead of rejecting it unobserved.
      finish?.(isConnected ? error : undefined)
    }
    const abort = () => {
      end(new Error(UI_TEXT.tuiDisconnected))
    }
    const timer = setTimeout(() => {
      end(new Error(UI_TEXT.tuiDisconnected))
    }, TUI_LIMITS.connectMs)
    options.signal.addEventListener('abort', abort, { once: true })
    if (options.signal.aborted) abort()
    socket.on('connect', () => {
      if (isEnded) return
      isConnected = true
      clearTimeout(timer)
      resolve({
        closed,
        close: () => {
          end()
        },
        send(action) {
          if (isEnded) throw new Error(UI_TEXT.tuiDisconnected)
          const frame: string | undefined = JSON.stringify(
            options.binding.encode(tuiActionSchema.parse(action)),
          )
          if (
            typeof frame !== 'string' ||
            Buffer.byteLength(frame) > TUI_LIMITS.frameBytes ||
            socket.writableLength > TUI_LIMITS.frameBytes
          ) {
            end(new Error(UI_TEXT.tuiInvalidFrame))
            throw new Error(UI_TEXT.tuiInvalidFrame)
          }
          socket.write(`${frame}\n`)
        },
      })
    })
    socket.on('data', (chunk: Buffer) => {
      if (isEnded) return
      try {
        let offset = 0
        while (offset < chunk.length) {
          const newline = chunk.indexOf('\n', offset)
          const part = chunk.subarray(offset, newline === -1 ? chunk.length : newline)
          if (buffer.length + part.length > TUI_LIMITS.frameBytes)
            throw new Error(UI_TEXT.tuiInvalidFrame)
          buffer = Buffer.concat([buffer, part])
          if (newline === -1) break
          const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer))
          buffer = Buffer.alloc(0)
          options.receive(tuiEventSchema.parse(options.binding.decode(raw)))
          offset = newline + 1
        }
      } catch (error: unknown) {
        // Any frame failure ends the connection as invalid; binding failures report.
        if (!isExpectedFrameError(error)) options.report(error)
        end(new Error(UI_TEXT.tuiInvalidFrame))
      }
    })
    socket.on('error', () => {
      end(new Error(UI_TEXT.tuiDisconnected))
    })
    socket.on('end', () => {
      end(new Error(UI_TEXT.tuiDisconnected))
    })
    socket.on('close', () => {
      if (!isEnded) end(new Error(UI_TEXT.tuiDisconnected))
    })
  })
}
