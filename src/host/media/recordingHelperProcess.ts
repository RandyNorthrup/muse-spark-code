// M105 RLF-RECORDING: how the three recorder drivers hold their native
// helper. One spawn (direct, argument array, credential-free guarded
// environment, no shell), seen three ways: the line port the Windows and
// Linux drivers read, and the `HelperChild` the macOS driver reads. The
// helper's stderr is drained and never kept: it can name paths and
// accounts.
import type { Readable } from 'node:stream'
import type { GuardedChildEnv } from '../../core/executables'
import { spawnGuarded } from '../../core/guardedChildProcess'
import type { HelperChild } from '../../core/voice/dictation'
import { createHelperLineFramer } from './recordingLineFramer'

/** An exec failure (a failure exit or a spawn fault) carries the run's `code`. */
export function isRunFailure(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (typeof cause.code === 'number' || typeof cause.code === 'string')
  )
}

export interface RecordingHelper {
  readonly stdout: Readable
  readonly stderr: Readable
  /** Writes one line to the helper; false once it has exited or its channel is closed. */
  readonly trySend: (line: string) => boolean
  /** Writes one line to the helper; throws once it has exited or its channel is closed. */
  readonly send: (line: string) => void
  /** Fires after stdout is drained and the handles are closed; null when it never started. */
  readonly onExit: (listener: (code: number | null) => void) => void
  /** Ends the helper and resolves once it has exited. */
  readonly kill: () => Promise<void>
}

/** The line port the Windows and Linux drivers run. */
export interface RecordingLineProcess {
  readonly onLine: (listener: (line: string) => void) => void
  readonly onExit: (listener: (code: number | null) => void) => void
  readonly send: (line: string) => void
  readonly trySend: (line: string) => boolean
  readonly kill: () => Promise<void>
}

export function startRecordingHelper(
  executable: string,
  args: readonly string[],
  env: GuardedChildEnv,
): RecordingHelper {
  const child = spawnGuarded(executable, args, {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  })
  let exitCode: number | null | undefined
  let exitListener: ((code: number | null) => void) | undefined
  const exitWaiters: (() => void)[] = []
  const finish = (code: number | null): void => {
    if (exitCode !== undefined) return
    exitCode = code
    exitListener?.(code)
    for (const waiter of exitWaiters.splice(0)) waiter()
  }
  // Drained, never read here: diagnostics must not stall the helper on a full pipe.
  child.stderr.resume()
  // A helper that closed its end (it died, or is dying) turns the next write
  // into EPIPE on the stream; its exit settles the run, so the error is not
  // an uncaught exception in the extension host.
  child.stdin.on('error', () => {
    /* The exit settles the run; there is nothing to send it to. */
  })
  child.on('error', () => {
    finish(null)
  })
  // 'close', not 'exit': the port settles after the stdio handles close.
  child.on('close', (code) => {
    finish(code)
  })
  const wasSent = (line: string): boolean => {
    const stdin = child.stdin
    if (exitCode !== undefined || stdin.destroyed || !stdin.writable) return false
    // A write that fails asynchronously means the helper is dying; its
    // exit settles the run.
    stdin.write(`${line}\n`, () => {
      /* The exit settles the run; there is nothing to send it to. */
    })
    return true
  }
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    trySend: wasSent,
    send: (line) => {
      if (!wasSent(line))
        throw new Error(
          exitCode === undefined ? 'the recorder channel is closed' : 'the recorder has exited',
        )
    },
    onExit: (listener) => {
      exitListener = listener
      if (exitCode !== undefined) listener(exitCode)
    },
    kill: () => {
      if (exitCode === undefined) {
        child.stdin.destroy()
        child.kill()
      }
      return new Promise<void>((resolve) => {
        if (exitCode === undefined) exitWaiters.push(resolve)
        else resolve()
      })
    },
  }
}

/**
The helper's stdout as lines. Lines and the exit are buffered until their
listener attaches, so a fast helper loses nothing.
*/
export function recordingLineProcess(helper: RecordingHelper): RecordingLineProcess {
  const framer = createHelperLineFramer()
  let lineListener: ((line: string) => void) | undefined
  const queuedLines: string[] = []
  const deliver = (line: string): void => {
    if (lineListener === undefined) queuedLines.push(line)
    else lineListener(line)
  }
  helper.stdout.on('data', (chunk: Buffer) => {
    const lines = framer.push(chunk.toString('utf8'))
    for (const line of lines) deliver(line)
  })
  // The trailing partial line is delivered before any exit report.
  let exitListener: ((code: number | null) => void) | undefined
  let exited: { readonly code: number | null } | undefined
  helper.onExit((code) => {
    const trailing = framer.end()
    for (const line of trailing) deliver(line)
    exited = { code }
    exitListener?.(code)
  })
  return {
    onLine: (listener) => {
      lineListener = listener
      for (const line of queuedLines.splice(0)) listener(line)
    },
    onExit: (listener) => {
      exitListener = listener
      if (exited !== undefined) listener(exited.code)
    },
    send: helper.send,
    trySend: helper.trySend,
    kill: helper.kill,
  }
}

/** The macOS driver's view: raw chunks and an exit it compares as `exit code 0`. */
export function recordingHelperChild(helper: RecordingHelper): HelperChild {
  return {
    stdout: helper.stdout,
    stderr: helper.stderr,
    send: helper.send,
    onExit: (listener) => {
      helper.onExit((code) => {
        listener(code === null ? 'did not run to an exit' : `exit code ${String(code)}`)
      })
    },
    kill: () => {
      void helper.kill()
    },
  }
}
