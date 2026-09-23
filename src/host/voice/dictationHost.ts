// The host side of voice dictation (M9): finds the helper for this platform
// and adapts Node's child process to the driver's `HelperChild`. One setup
// per window; each conversation creates its own driver from it on first use.

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
  helperEnvironment,
  type HelperProbe,
  locateDictationHelper,
} from '../../core/voice/helperLocation'
import { EXTENSION_QUALIFIED_ID } from '../../shared/constants'

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

export function spawnHelper(
  invocation: HelperInvocation,
  start: (invocation: HelperInvocation) => HelperProcess = startProcess,
): HelperChild {
  const child = start(invocation)
  let exitListener: ((description: string) => void) | undefined
  let isExited = false
  let stdinFailure: string | undefined
  const exited = (description: string) => {
    if (isExited) {
      return
    }
    isExited = true
    exitListener?.(
      stdinFailure === undefined ? description : `${description} (stdin: ${stdinFailure})`,
    )
  }
  child.on('error', (error) => {
    exited(`could not start: ${error.message}`)
  })
  child.on('exit', (code, signal) => {
    exited(code === null ? `${SIGNAL_EXIT} ${signal ?? 'unknown'}` : `exit code ${String(code)}`)
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
      if (isExited || stdinFailure !== undefined || !child.stdin.writable) {
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
