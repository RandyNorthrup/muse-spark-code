// A capture helper made of the system's own recorder (M35, Linux): ALSA's
// `arecord` or PulseAudio's `parec` writes raw 16-bit mono PCM on stdout for
// as long as it runs. This adapter speaks the helper line protocol over it,
// so the resident-helper driver (`dictation.ts`) drives it like the Windows
// and macOS capture helpers: "ready" at once, a recorder process per
// recording ("start" starts it, "stop" ends it), its output as "audio"
// lines, "stopped" when it has exited. No `child_process` here: the host
// injects the start.

import { Buffer } from 'node:buffer'
import { DICTATION_HELPER_COMMANDS, DICTATION_STDERR_TAIL_CHARS } from '../../shared/constants'
import type { HelperChild } from './dictation'

type ChunkListener = (chunk: Buffer | string) => void

/** The slice of a recorder process the adapter touches. */
export interface RecorderProcess {
  onData(listener: (chunk: Uint8Array) => void): void
  onStderr(listener: (chunk: string) => void): void
  /** Fires once, when the process has exited or could not be started. */
  onExit(listener: (description: string) => void): void
  kill(): void
}

/** A stream of the helper's lines, as the driver reads a child's stdout. */
class LineStream {
  private readonly listeners: ChunkListener[] = []

  public on(_event: 'data', listener: ChunkListener): this {
    this.listeners.push(listener)
    return this
  }

  public write(payload: Record<string, unknown>): void {
    const line = `${JSON.stringify(payload)}\n`
    for (const listener of this.listeners) {
      listener(line)
    }
  }
}

/** A never-writing stderr: the recorder's own is folded into the error line. */
const SILENT = { on: () => SILENT }

export function recorderHelper(recorderName: string, start: () => RecorderProcess): HelperChild {
  const stdout = new LineStream()
  let recorder: RecorderProcess | undefined
  let isStopping = false
  let exitListener: ((description: string) => void) | undefined
  let hasExited = false
  const exit = () => {
    if (hasExited) {
      return
    }
    hasExited = true
    recorder?.kill()
    exitListener?.('exit code 0')
  }
  const startRecording = () => {
    if (recorder !== undefined) {
      return
    }
    let stderrTail = ''
    const running = start()
    recorder = running
    isStopping = false
    running.onData((chunk) => {
      stdout.write({ type: 'audio', data: Buffer.from(chunk).toString('base64') })
    })
    running.onStderr((chunk) => {
      stderrTail = (stderrTail + chunk).slice(-DICTATION_STDERR_TAIL_CHARS)
    })
    running.onExit((description) => {
      if (recorder !== running) {
        return
      }
      recorder = undefined
      if (isStopping) {
        stdout.write({ type: 'stopped' })
        return
      }
      const detail = stderrTail.trim().split('\n').at(-1) ?? ''
      stdout.write({
        type: 'error',
        reason: `${recorderName} ended (${description})${detail === '' ? '' : `: ${detail}`}`,
      })
    })
    stdout.write({ type: 'listening' })
  }
  queueMicrotask(() => {
    stdout.write({ type: 'ready', language: 'pcm_s16le', recognizer: recorderName })
  })
  return {
    stdout,
    stderr: SILENT,
    send(line) {
      switch (line) {
        case DICTATION_HELPER_COMMANDS.start: {
          startRecording()
          break
        }
        case DICTATION_HELPER_COMMANDS.stop: {
          if (recorder !== undefined) {
            isStopping = true
            recorder.kill()
          }
          break
        }
        case DICTATION_HELPER_COMMANDS.quit: {
          exit()
          break
        }
      }
    },
    onExit(listener) {
      exitListener = listener
    },
    kill() {
      exit()
    },
  }
}
