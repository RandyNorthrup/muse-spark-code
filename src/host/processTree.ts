// Ending a command together with everything it started (PLAN.md D25).
// `ChildProcess.kill` signals one process: a shell killed on a timeout or a
// Stop leaves its children running, and a grandchild that still holds the
// output pipes keeps the tool call open for ever (Claude Code #90672 is the
// same bug). On POSIX the command runs as the leader of its own process
// group and the whole group is signalled; on Windows `taskkill /T /F` ends
// the process tree. A process that has already exited is never signalled,
// so a recycled process id is never hit.

import { type ChildProcess, execFile } from 'node:child_process'
import path from 'node:path'
import { WINDOWS_TASKKILL_RELATIVE_PATH } from '../shared/constants'

const SIGKILL = 'SIGKILL'

export interface ProcessTreeDeps {
  readonly platform: NodeJS.Platform
  /** `%SystemRoot%`; undefined off Windows. */
  readonly systemRoot: string | undefined
  readonly log: (message: string) => void
}

/** Spawn options that make a later tree kill possible. */
export function treeSpawnOptions(platform: NodeJS.Platform): { readonly detached: boolean } {
  // A new process group (and session) on POSIX; on Windows `detached` would
  // give the command a console of its own instead, so it stays attached.
  return { detached: platform !== 'win32' }
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

/** Kills `child` and its descendants; a no-op once it has exited. */
export function killTree(child: ChildProcess, deps: ProcessTreeDeps): void {
  const { pid } = child
  if (pid === undefined || hasExited(child)) {
    return
  }
  if (deps.platform !== 'win32') {
    try {
      process.kill(-pid, SIGKILL)
    } catch (error: unknown) {
      // The group may be gone already; the leader itself still gets the signal.
      deps.log(`process group ${String(pid)} could not be signalled: ${String(error)}`)
      child.kill(SIGKILL)
    }
    return
  }
  if (deps.systemRoot === undefined) {
    child.kill(SIGKILL)
    return
  }
  execFile(
    path.win32.join(deps.systemRoot, WINDOWS_TASKKILL_RELATIVE_PATH),
    ['/PID', String(pid), '/T', '/F'],
    { windowsHide: true },
    (error) => {
      if (error === null || hasExited(child)) {
        return
      }
      deps.log(`taskkill of ${String(pid)} failed (${error.message}); killing the shell only`)
      child.kill(SIGKILL)
    },
  )
}
