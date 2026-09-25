// The host side of voice dictation (M9): finds the helper for this platform
// and adapts Node's child process to the driver's `HelperChild`. One setup
// per window; each conversation creates its own driver from it on first use.
// Muse Voice (M35) adds its capture helper, the Linux recorders and the
// WebSocket to Meta.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { Readable, Writable } from 'node:stream'
import { env, ExtensionKind, extensions } from 'vscode'
import type { CoreLogger } from '../../core/logging'
import {
  Dictation,
  type DictationHandle,
  type DictationListener,
  type HelperChild,
  type HelperInvocation,
} from '../../core/voice/dictation'
import {
  type CaptureProbe,
  helperEnvironment,
  type HelperProbe,
  locateCaptureHelper,
  locateDictationHelper,
} from '../../core/voice/helperLocation'
import {
  MuseVoiceDictation,
  type VoiceSocket,
  type VoiceSocketHandlers,
} from '../../core/voice/museVoice'
import { type RecorderProcess, recorderHelper } from '../../core/voice/recorderHelper'
import { EXTENSION_QUALIFIED_ID, MUSE_VOICE_REALTIME_URL, UI_TEXT } from '../../shared/constants'

export type DictationSetup =
  | {
      readonly isAvailable: true
      readonly create: (listener: DictationListener) => DictationHandle
    }
  | { readonly isAvailable: false; readonly reason: string }

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
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- the command line is fixed by helperLocation.ts (Windows PowerShell under %SystemRoot% with the bundled script, or the bundled macOS binary with VS Code's own app name) and passed as an argument array; nothing from the user, the model or the workspace is in it (PLAN.md §8)
  return spawn(invocation.command, [...invocation.args], {
    env: helperEnvironment(process.env, invocation, process.platform),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
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

/**
 * The remote this extension host runs on, or undefined on the user's own
 * machine. `env.remoteName` alone is not enough: it is also set in the local
 * extension host of a remote window ("defined in all extension hosts (local
 * and remote) in case a remote extension host exists", vscode.d.ts), where
 * a user's `remote.extensionKind` override could run this extension; the
 * extension's kind says which side it is on.
 */
function remoteHostName(): string | undefined {
  const kind = extensions.getExtension(EXTENSION_QUALIFIED_ID)?.extensionKind
  return kind === ExtensionKind.UI ? undefined : env.remoteName
}

export function createDictationSetup(
  probe: Omit<HelperProbe, 'fileExists' | 'programFiles' | 'remoteName' | 'appName'>,
  log: CoreLogger,
): DictationSetup {
  const location = locateDictationHelper({
    ...probe,
    fileExists: existsSync,
    programFiles: process.env['ProgramFiles'],
    remoteName: remoteHostName(),
    appName: env.appName,
  })
  if (!location.isAvailable) {
    log.info(`Voice dictation unavailable: ${location.reason}`)
    return location
  }
  return {
    isAvailable: true,
    create: (listener) =>
      new Dictation({ invocation: location.invocation, spawn: spawnHelper, listener, log }),
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
function startRecorder(command: string, args: readonly string[]): RecorderProcess {
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- the command is arecord or parec found by absolute path on PATH (helperLocation.ts, resolveExecutable) with fixed arguments from constants.ts; nothing from the user, the model or the workspace is in it (PLAN.md §8)
  const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
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

export interface MuseVoiceSetupDeps {
  /** The Model API key, read per recording. */
  readonly apiKey: () => Promise<string | undefined>
  /** Counts whole seconds of audio sent, for the window's tally. */
  readonly onSeconds: (seconds: number) => void
  readonly log: CoreLogger
}

/**
 * Muse Voice (M35, PLAN.md D30): the paid engine's recorder for this
 * platform and the stream to Meta, or why it cannot run here. Whether it is
 * the microphone's engine (the setting, the accepted price, the Model API
 * backend) is the caller's to decide.
 */
export function createMuseVoiceSetup(
  probe: Omit<
    CaptureProbe,
    'fileExists' | 'programFiles' | 'remoteName' | 'appName' | 'pathVariable'
  >,
  deps: MuseVoiceSetupDeps,
): DictationSetup {
  if (typeof globalThis.WebSocket !== 'function') {
    return { isAvailable: false, reason: UI_TEXT.museVoiceNoWebSocket }
  }
  const location = locateCaptureHelper({
    ...probe,
    fileExists: existsSync,
    programFiles: process.env['ProgramFiles'],
    remoteName: remoteHostName(),
    appName: env.appName,
    pathVariable: process.env['PATH'],
  })
  if (!location.isAvailable) {
    deps.log.info(`Muse Voice unavailable: ${location.reason}`)
    return location
  }
  const invocation: HelperInvocation =
    location.kind === 'helper'
      ? location.invocation
      : { command: location.command, args: location.args }
  const spawnCapture =
    location.kind === 'helper'
      ? spawnHelper
      : () => recorderHelper(location.name, () => startRecorder(location.command, location.args))
  return {
    isAvailable: true,
    create: (listener) =>
      new MuseVoiceDictation(
        {
          createCapture: (captureListener) =>
            new Dictation({
              invocation,
              spawn: spawnCapture,
              listener: captureListener,
              log: deps.log,
            }),
          openSocket: openWebSocket,
          url: MUSE_VOICE_REALTIME_URL,
          apiKey: deps.apiKey,
          onSeconds: deps.onSeconds,
          log: deps.log,
        },
        listener,
      ),
  }
}
