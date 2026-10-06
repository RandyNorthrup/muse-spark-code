// The processes and the socket behind voice (M9, M35): Node's child process
// adapted to the driver's `HelperChild`, Linux's recorder, and the platform's
// WebSocket to Meta. Part of dist/voice.js (PLAN.md D6), loaded on the first
// recording; no `vscode` here.

import { spawn } from 'node:child_process'
import { PassThrough, type Readable, type Writable } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { admitResource, resourceWindowsJob, stopResourceTree } from '../../core/resources/admission'
import type { ResourceLease } from '../../core/resources/launch'
import { spawnMcpJob } from '../backend/mcpJobLaunch'
import { observeResourceProcess } from '../resources/resourceAdmission'
import { treeSpawnOptions } from '../processTree'
import { withoutCredentials } from '../../core/credentialEnvironment'
import type { HelperChild, HelperInvocation } from '../../core/voice/dictation'
import { helperEnvironment } from '../../core/voice/helperLocation'
import type { VoiceSocket, VoiceSocketHandlers } from '../../core/voice/museVoice'
import type { RecorderProcess } from '../../core/voice/recorderHelper'

const SIGNAL_EXIT = 'signal'

/** The slice of a Node child process the adapter touches; `spawn` returns one. */
export interface HelperProcess {
  readonly stdin: Writable
  readonly stdout: Readable
  readonly stderr: Readable
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  kill(): unknown
}

function startProcess(invocation: HelperInvocation): HelperProcess {
  return admittedVoiceProcess(
    invocation.command,
    invocation.args,
    helperEnvironment(process.env, invocation, process.platform),
  )
}

/** The synchronous driver receives pipes immediately; its actual helper waits for admission. */
function admittedVoiceProcess(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): HelperProcess {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const events = stdout
  const stop = new AbortController()
  let child: ChildProcessWithoutNullStreams | undefined
  let resource: ResourceLease | undefined
  const start = async () => {
    resource = await admitResource('other', stop.signal)
    try {
      const job =
        resource !== undefined && process.platform === 'win32'
          ? await resourceWindowsJob()
          : undefined
      if (stop.signal.aborted) {
        resource?.complete(true)
        events.emit('exit', null, 'SIGTERM')
        return
      }
      // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- the fixed bundled dictation helper or absolute recorder command from helperLocation with fixed flags; nothing from the model or workspace reaches this command (PLAN.md §8).
      child =
        job === undefined
          ? spawn(command, [...args], {
              env: withoutCredentials(env),
              stdio: ['pipe', 'pipe', 'pipe'],
              windowsHide: true,
              ...treeSpawnOptions(process.platform),
            })
          : spawnMcpJob({
              executablePath: job.executablePath,
              resourceAssembly: job.assemblyPath,
              file: command,
              args,
              cwd: process.cwd(),
              env: withoutCredentials(env),
              isVerbatim: false,
              resource,
              log: () => {
                /* A helper's own stderr and exit report its launch failure. */
              },
            })
      if (job === undefined) observeResourceProcess(resource, child)
      child.once('error', (error) => {
        events.emit('error', error)
      })
      child.once('exit', (code, signal) => {
        events.emit('exit', code, signal)
      })
      child.stdin.on('error', (error) => {
        stdin.destroy(error)
      })
      stdin.pipe(child.stdin)
      child.stdout.pipe(stdout)
      child.stderr.pipe(stderr)
    } catch (error: unknown) {
      resource?.complete(child === undefined)
      throw error
    }
  }
  void start().catch((error: unknown) => {
    if (stop.signal.aborted) events.emit('exit', null, 'SIGTERM')
    else
      events.emit(
        'error',
        error instanceof Error ? error : new Error('Voice helper could not start'),
      )
  })
  return {
    stdin,
    stdout,
    stderr,
    on: events.on.bind(events),
    kill: () => {
      stop.abort()
      if (child === undefined) return
      if (resource === undefined) child.kill()
      else
        void stopResourceTree(resource).catch((error: unknown) => {
          events.emit('error', error)
        })
    },
  }
}

/** The events of a child process the exit report reads. */
type ExitEvents = Pick<HelperProcess, 'on'>

/**
 * Reports a child's end once, however it ended: it could not start, it
 * exited with a code, or a signal ended it. Returns whether it has ended.
 */
function watchExit(child: ExitEvents, onExit: (description: string) => void): () => boolean {
  let isExited = false
  const exited = (description: string) => {
    if (isExited) {
      return
    }
    isExited = true
    onExit(description)
  }
  child.on('error', (error) => {
    exited(`could not start: ${error.message}`)
  })
  child.on('exit', (code, signal) => {
    exited(code === null ? `${SIGNAL_EXIT} ${signal ?? 'unknown'}` : `exit code ${String(code)}`)
  })
  return () => isExited
}

export function spawnHelper(
  invocation: HelperInvocation,
  start: (invocation: HelperInvocation) => HelperProcess = startProcess,
): HelperChild {
  const child = start(invocation)
  let exitListener: ((description: string) => void) | undefined
  let stdinFailure: string | undefined
  const hasExited = watchExit(child, (description) => {
    exitListener?.(
      stdinFailure === undefined ? description : `${description} (stdin: ${stdinFailure})`,
    )
  })
  // A helper that has closed its end of the pipe (it died, or is dying)
  // turns the next write into EPIPE (EOF on Windows), emitted as an 'error'
  // on the stream: without a listener that is an uncaught exception in the
  // extension host (M26, D29). The helper cannot take commands any more,
  // so it is ended and its exit reports the failure.
  child.stdin.on('error', (error) => {
    stdinFailure ??= error.message
    child.kill()
  })
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    send(line) {
      // Nothing is written once the helper has gone or its pipe has failed.
      if (stdinFailure !== undefined || hasExited() || !child.stdin.writable) {
        return
      }
      child.stdin.write(`${line}\n`)
    },
    onExit(listener) {
      exitListener = listener
    },
    kill() {
      child.kill()
    },
  }
}

/** The platform's WebSocket as Muse Voice's socket (M35); Node's own, no third-party code. */
export function openWebSocket(url: string, handlers: VoiceSocketHandlers): VoiceSocket {
  const socket = new WebSocket(url)
  socket.binaryType = 'arraybuffer'
  socket.addEventListener('open', () => {
    handlers.onOpen()
  })
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') {
      handlers.onText(event.data)
    }
  })
  // A failed connection is followed by its close (1006), which says so.
  socket.addEventListener('close', (event) => {
    handlers.onClose(event.code, event.reason)
  })
  return {
    sendText: (text) => {
      socket.send(text)
    },
    // A copy on a plain ArrayBuffer, which every WebSocket send accepts.
    sendBinary: (bytes) => {
      socket.send(new Uint8Array(bytes))
    },
    close: () => {
      socket.close()
    },
  }
}

/** The system's recorder, one process per recording (Linux, M35). */
export function startRecorder(command: string, args: readonly string[]): RecorderProcess {
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- the command is arecord or parec found by absolute path on PATH (helperLocation.ts, resolveExecutable) with fixed arguments from constants.ts; nothing from the user, the model or the workspace is in it (PLAN.md §8)
  const child = admittedVoiceProcess(command, args, process.env)
  let exitListener: ((description: string) => void) | undefined
  watchExit(child, (description) => {
    exitListener?.(description)
  })
  return {
    onData: (listener) => {
      child.stdout.on('data', listener)
    },
    onStderr: (listener) => {
      child.stderr.on('data', (chunk: Buffer) => {
        listener(chunk.toString('utf8'))
      })
    },
    onExit: (listener) => {
      exitListener = listener
    },
    kill: () => {
      child.kill()
    },
  }
}
