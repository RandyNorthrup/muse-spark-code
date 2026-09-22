// The host side of voice dictation (M9): finds the helper for this platform
// and adapts Node's child process to the driver's `HelperChild`. One setup
// per window; each conversation creates its own driver from it on first use.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { CoreLogger } from '../../core/logging'
import {
  Dictation,
  type DictationListener,
  type HelperChild,
  type HelperInvocation,
} from '../../core/voice/dictation'
import { type HelperProbe, locateDictationHelper } from '../../core/voice/helperLocation'

export type DictationSetup =
  | { readonly isAvailable: true; readonly create: (listener: DictationListener) => Dictation }
  | { readonly isAvailable: false; readonly reason: string }

const SIGNAL_EXIT = 'signal'

export function spawnHelper(invocation: HelperInvocation): HelperChild {
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- the command line is fixed by helperLocation.ts (Windows PowerShell under %SystemRoot% with the bundled script, or the bundled macOS binary) and passed as an argument array; nothing from the user, the model or the workspace is in it (PLAN.md §8)
  const child = spawn(invocation.command, [...invocation.args], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let exitListener: ((description: string) => void) | undefined
  let isExited = false
  const exited = (description: string) => {
    if (isExited) {
      return
    }
    isExited = true
    exitListener?.(description)
  }
  child.on('error', (error) => {
    exited(`could not start: ${error.message}`)
  })
  child.on('exit', (code, signal) => {
    exited(code === null ? `${SIGNAL_EXIT} ${signal ?? 'unknown'}` : `exit code ${String(code)}`)
  })
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    send(line) {
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

export function createDictationSetup(
  probe: Omit<HelperProbe, 'fileExists'>,
  log: CoreLogger,
): DictationSetup {
  const location = locateDictationHelper({ ...probe, fileExists: existsSync })
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
