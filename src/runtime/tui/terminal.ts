import type { Readable, Writable } from 'node:stream'
import type { EventEmitter } from 'node:events'
import { StringDecoder } from 'node:string_decoder'
import { TUI_LIMITS, UI_TEXT } from '../../shared/constants'
import type { TuiTerminal } from './run'

/** Only terminal I/O, no credential, model, tool or sign-in capability. */
export function createTuiTerminal(
  input: Readable & { isTTY?: boolean; isRaw?: boolean; setRawMode?: (isRaw: boolean) => unknown },
  output: Writable & { isTTY?: boolean; columns?: number; rows?: number },
  signals: EventEmitter,
): TuiTerminal {
  const attach = (target: EventEmitter, event: string, handler: () => void) => {
    target.on(event, handler)
    return () => {
      target.off(event, handler)
    }
  }
  return {
    isTTY: input.isTTY === true && output.isTTY === true,
    dimensions: () => ({
      columns: output.columns ?? TUI_LIMITS.terminalColumns,
      rows: output.rows ?? TUI_LIMITS.terminalRows,
    }),
    write(text, displayed) {
      if (
        output.destroyed ||
        output.writableLength + Buffer.byteLength(text) > TUI_LIMITS.frameBytes
      )
        throw new Error(UI_TEXT.tuiDisconnected)
      output.write(text, (error) => {
        if (error === null || error === undefined) displayed?.()
      })
    },
    discardInput() {
      while (input.read() !== null) {
        /* Drain type-ahead before a new ask. */
      }
    },
    flush() {
      if (output.writableFinished) return Promise.resolve()
      if (output.destroyed) return Promise.reject(new Error(UI_TEXT.tuiDisconnected))
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          output.destroy()
          reject(new Error(UI_TEXT.tuiDisconnected))
        }, TUI_LIMITS.outputMs)
        const finish = (error?: Error | null) => {
          clearTimeout(timer)
          if (error === null || error === undefined) resolve()
          else reject(new Error(UI_TEXT.tuiDisconnected))
        }
        try {
          output.write('', finish)
        } catch (error: unknown) {
          // A synchronous probe failure rejects the flush with its real cause.
          clearTimeout(timer)
          throw error
        }
      })
    },
    read(handler) {
      const wasRaw = input.isRaw === true
      const wasPaused = input.isPaused()
      const decoder = new StringDecoder('utf8')
      // Raw input is required for a single Esc press even in linear mode.
      // It never emits cursor controls or echoes a key/secret being entered.
      if (input.isTTY === true) input.setRawMode?.(true)
      if (input.isTTY === true && output.isTTY === true) output.write('\u{1B}[?2004h')
      const receive = (chunk: unknown) => {
        if (typeof chunk === 'string') handler(chunk)
        else if (Buffer.isBuffer(chunk)) handler(decoder.write(chunk))
        else throw new Error(UI_TEXT.tuiInvalidFrame)
      }
      input.on('data', receive)
      input.resume()
      return () => {
        input.off('data', receive)
        if (input.isTTY === true && output.isTTY === true && !output.destroyed)
          output.write('\u{1B}[?2004l')
        if (input.isTTY === true) input.setRawMode?.(wasRaw)
        if (wasPaused) input.pause()
      }
    },
    onResize: (handler) => attach(output, 'resize', handler),
    onInterrupt: (handler) => attach(signals, 'SIGINT', handler),
    onClose(handler) {
      const closed = () => {
        handler(false)
      }
      const failed = () => {
        handler(true)
      }
      const removeEnd = attach(input, 'end', closed)
      const removeInput = attach(input, 'close', closed)
      const removeInputError = attach(input, 'error', failed)
      const removeError = attach(output, 'error', failed)
      const removeOutput = attach(output, 'close', () => {
        handler(!output.writableFinished)
      })
      if (input.errored !== null || output.errored !== null) failed()
      else if (output.destroyed) handler(!output.writableFinished)
      else if (input.readableEnded || input.destroyed) closed()
      return () => {
        removeEnd()
        removeInput()
        removeInputError()
        removeError()
        removeOutput()
      }
    },
  }
}
