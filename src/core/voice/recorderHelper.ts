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
  /** Resource admission and the OS spawn succeeded; never fires on a failed launch. */
  onStarted(listener: () => void): void
  onData(listener: (chunk: Uint8Array) => void): void
  onStderr(listener: (chunk: string) => void): void
  /** Fires once, when the process has really exited. Never on a failed stop. */
  onExit(listener: (description: string) => void): void
  /**
   * Fires when the recorder could not be launched, or an explicit kill was
   * refused (the process may still be recording). The adapter tells those
   * apart by whether a recorder is running.
   */
  onError(listener: (description: string) => void): void
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
  let isQuitting = false
  let exitListener: ((description: string) => void) | undefined
  let hasExited = false
  /**
   * No recorder process exists: report the exit once. A quit with a
   * recorder running waits for its real end instead (RVCM352B P1-b).
   */
  const exit = (description: string) => {
    if (hasExited) {
      return
    }
    hasExited = true
    exitListener?.(description)
  }
  const quit = () => {
    if (hasExited) {
      return
    }
    isQuitting = true
    if (recorder === undefined) {
      exit('quit')
      return
    }
    recorder.kill()
  }
  const startRecording = () => {
    if (hasExited || recorder !== undefined) {
      // Quit while a spawn was in flight: the kill already aborted it, so
      // no recording may start here and none can linger.
      return
    }
    let stderrTail = ''
    let running: RecorderProcess
    try {
      running = start()
    } catch (error: unknown) {
      stdout.write({
        type: 'error',
        reason: `${recorderName}: ${error instanceof Error ? error.message : String(error)}`,
      })
      return
    }
    recorder = running
    isStopping = false
    // An ended recorder reports once, with the stderr tail for the cause.
    const reportEnded = (description: string): void => {
      recorder = undefined
      const detail = stderrTail.trim().split('\n').at(-1) ?? ''
      stdout.write({
        type: 'error',
        reason: `${recorderName} ended (${description})${detail === '' ? '' : `: ${detail}`}`,
      })
      exit(description)
    }
    running.onData((chunk) => {
      if (hasExited || recorder !== running) return
      stdout.write({ type: 'audio', data: Buffer.from(chunk).toString('base64') })
    })
    running.onStderr((chunk) => {
      stderrTail = (stderrTail + chunk).slice(-DICTATION_STDERR_TAIL_CHARS)
    })
    running.onError((description) => {
      if (hasExited || recorder !== running) {
        return
      }
      if (isStopping || isQuitting) {
        // A kill was refused while ending it: the process may still hold
        // the microphone, so this is an error, never "stopped".
        recorder = undefined
        stdout.write({ type: 'error', reason: `${recorderName} did not stop (${description})` })
        return
      }
      reportEnded(description)
    })
    running.onExit((description) => {
      if (hasExited || recorder !== running) {
        return
      }
      recorder = undefined
      if (isQuitting) {
        exit(description)
        return
      }
      if (isStopping) {
        // The recorder really exited: only now is the stop complete.
        stdout.write({ type: 'stopped' })
        return
      }
      reportEnded(description)
    })
    running.onStarted(() => {
      if (!hasExited && recorder === running && !isStopping) {
        stdout.write({ type: 'listening' })
      }
    })
  }
  queueMicrotask(() => {
    if (hasExited) return
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
          if (!hasExited && recorder !== undefined) {
            isStopping = true
            recorder.kill()
          }
          break
        }
        case DICTATION_HELPER_COMMANDS.quit: {
          quit()
          break
        }
      }
    },
    onExit(listener) {
      exitListener = listener
    },
    kill() {
      quit()
    },
  }
}
