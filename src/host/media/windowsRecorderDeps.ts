// M105 R2: the Windows screen recorder's mechanical host deps. The
// interactive entry point adds its own gesture, locality, shutdown and
// length; everything here is wiring: compile the shipped helper once with
// the inbox compiler, revalidate its path before each launch, spawn it
// directly with a credential-free environment, reserve its private
// directories, and inspect its finished file with M1's bounded sniffer.
// Nothing here records on its own.
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { lstat, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { WindowsRecorderDeps, WindowsRecorderProcess } from '../../core/media/record/windows'
import { noWorkspaceChildEnvironment } from '../../core/execGuard'
import { withoutCredentials } from '../../core/credentialEnvironment'
import { spawnGuarded } from '../../core/guardedChildProcess'
import { runProgram, type RunProgram } from '../processTree'
import { converterTrustedPath } from '../../runtime/converterTrust'
import { screenRecordExecutable } from '../backend/jobBuild'
import { jobSourceReader } from '../backend/jobSource'
import { isStoreErrorCode } from '../backend/storeErrors'
import type { UiTable } from '../l10n'
import { inspectRecordingFile } from './recordingInspect'
import { createHelperLineFramer } from './recordingLineFramer'

export type { HelperLineFramer } from './recordingLineFramer'
export { createHelperLineFramer } from './recordingLineFramer'

/** The leaf prefix the helper's CreatePrivate requires: its recording namespace. */
const RECORDING_NAMESPACE = 'muse-spark-screen-'

export interface WindowsRecorderHost {
  /** The extension's folder: the shipped C# is read from under it. */
  readonly extensionPath: string
  /** The host's trusted storage for the built helper. */
  readonly storageDir: string
  /** The host's trusted temp root for reserved directories. */
  readonly tempRoot: string
  readonly systemRoot: string
  /** The caller's language, installed before the sniffer reads a refusal. */
  readonly l10n: UiTable
  readonly run?: RunProgram
}

/** The entry point adds gesture, locality, shutdown and length to these. */
export type WindowsRecorderMechanicalDeps = Pick<
  WindowsRecorderDeps,
  | 'prepareHelper'
  | 'probeRecording'
  | 'verifyHelper'
  | 'launch'
  | 'reserveDirectory'
  | 'removeDirectory'
  | 'inspect'
>

/** An exec failure (a failure exit or a spawn fault) carries the run's `code`. */
function isRunFailure(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (typeof cause.code === 'number' || typeof cause.code === 'string')
  )
}

export function createWindowsRecorderDeps(
  host: WindowsRecorderHost,
): WindowsRecorderMechanicalDeps {
  const run = host.run ?? runProgram
  const trust = converterTrustedPath('win32', { SystemRoot: host.systemRoot })
  const isTrusted = async (file: string): Promise<boolean> => {
    const verdict = await trust.verify(file, { leafKind: 'file' })
    return 'ok' in verdict
  }
  const prepare = screenRecordExecutable({
    storageDir: host.storageDir,
    systemRoot: host.systemRoot,
    readSource: () => jobSourceReader(host.extensionPath)('screenRecorder'),
    verifyTrustedPath: isTrusted,
    // Direct, like every other spawn here: building the helper is host
    // setup (the converter's trust probes spawn directly too), and the
    // governed runner needs admission the host has not granted this early.
    run,
  })
  // The helper's child env: SystemRoot only, credential-free, absolute PATH
  // entries only (the guarded child env spawnGuarded takes).
  const childEnv = noWorkspaceChildEnvironment(
    'win32',
    withoutCredentials({ SystemRoot: host.systemRoot }),
    realpathSync,
  )

  const launch: WindowsRecorderDeps['launch'] = (executable, args) => {
    const child = spawnGuarded(executable, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv,
    })
    const framer = createHelperLineFramer()
    let lineListener: ((line: string) => void) | undefined
    let exitListener: ((code: number | null) => void) | undefined
    const queuedLines: string[] = []
    let exitCode: number | null | undefined
    const exitWaiters: (() => void)[] = []
    const deliver = (line: string): void => {
      if (lineListener === undefined) queuedLines.push(line)
      else lineListener(line)
    }
    const finish = (code: number | null): void => {
      if (exitCode !== undefined) return
      for (const line of framer.end()) deliver(line)
      exitCode = code
      exitListener?.(code)
      for (const waiter of exitWaiters.splice(0)) waiter()
    }
    child.stdout.on('data', (chunk: Buffer) => {
      const lines = framer.push(chunk.toString('utf8'))
      for (const line of lines) deliver(line)
    })
    // Drained, never read: diagnostics must not stall the helper on a full pipe.
    child.stderr.resume()
    child.on('error', () => {
      finish(null)
    })
    // 'close', not 'exit': the port settles after the stdio handles close.
    child.on('close', (code) => {
      finish(code)
    })
    const process: WindowsRecorderProcess = {
      onLine: (listener) => {
        lineListener = listener
        for (const line of queuedLines.splice(0)) listener(line)
      },
      onExit: (listener) => {
        exitListener = listener
        if (exitCode !== undefined) listener(exitCode)
      },
      send: (command) => {
        if (exitCode !== undefined) throw new Error('the recorder has exited')
        const stdin = child.stdin
        if (stdin.destroyed || !stdin.writable) throw new Error('the recorder channel is closed')
        // The helper's stdin loop reads "stop" literally; anything else,
        // including "cancel", cancels. A write that fails asynchronously
        // means the helper is dying; its exit settles the run.
        stdin.write(`${command}\n`, () => {
          /* The exit settles the run; there is nothing to send it to. */
        })
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
    return process
  }

  return {
    prepareHelper: () => prepare(),
    probeRecording: async (executable) => {
      try {
        await run(executable, ['--probe'], childEnv)
        return true
      } catch (error: unknown) {
        // The binary answered no (a failure exit) or could not start: either
        // way capture is unavailable. Anything else is a bug in the probe.
        if (error instanceof Error && isRunFailure(error.cause)) return false
        throw error
      }
    },
    verifyHelper: isTrusted,
    launch,
    reserveDirectory: async () => {
      await mkdir(host.tempRoot, { recursive: true })
      for (;;) {
        const directory = path.join(host.tempRoot, `${RECORDING_NAMESPACE}${randomUUID()}`)
        try {
          await lstat(directory)
        } catch (error: unknown) {
          // Absent is the reservation; anything else is not this probe's to swallow.
          if (isStoreErrorCode(error, 'ENOENT')) return directory
          throw error
        }
      }
    },
    removeDirectory: async (directory) => {
      // Only our own namespace goes: a path no reservation made is a bug in
      // the caller and is refused, never removed.
      if (path.win32.basename(directory).startsWith(RECORDING_NAMESPACE)) {
        await rm(directory, { recursive: true, force: true })
        return
      }
      throw new Error('refusing to remove outside the recording namespace')
    },
    inspect: (file) => inspectRecordingFile(file, host.l10n),
  }
}
