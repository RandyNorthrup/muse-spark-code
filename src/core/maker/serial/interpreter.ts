import path from 'node:path'
import { UI_TEXT } from '../../../shared/constants'
import { environmentValue, isWorkspacePath, resolveAllExecutables } from '../../execGuard'

export interface SerialInterpreterProbe {
  readonly platform: NodeJS.Platform
  /** The helper's environment: its PATH is the only search path. */
  readonly env: NodeJS.ProcessEnv
  /** The run workspace: no program inside it (resolved through links) is ever the interpreter. */
  readonly workspaceRoot: string
  readonly fileExists: (filePath: string) => boolean
  readonly realpath: (filePath: string) => string
  /**
  The Python the person set for this machine (`serialPythonPath`): one absolute
  path, used as given, so a virtual environment's own `python3` finds its
  packages. Absent or empty finds `python3` on PATH.
  */
  readonly configured?: string | undefined
}

/** The same test the PATH search applies, for the one path the person set: lexically or by its real path in the workspace. */
function isInWorkspace(probe: SerialInterpreterProbe, candidate: string): boolean {
  const named = { workspaceRoot: probe.workspaceRoot, realpath: (filePath: string) => filePath }
  const real = { workspaceRoot: probe.workspaceRoot, realpath: probe.realpath }
  return (
    isWorkspacePath(probe.platform, named, candidate) ||
    isWorkspacePath(probe.platform, real, candidate)
  )
}

/**
The POSIX serial helper's Python (`native/posix/serial.py` runs under it, with
pyserial from the person's install) as one absolute path: the one the person
set for this machine, else `python3` found on the absolute entries of PATH
outside the run workspace, as `gh`, `git` and the Linux recorders are found. A
bare `python3` would let a program planted in a relative or workspace PATH
entry run in place of the interpreter (CC-WINRUNTEAM). A hit whose real path
lies inside the workspace (a link to a planted file) is skipped as well, and a
set path inside the workspace is refused, never started: a project could
supply a virtual environment's packages. No python3 there, or a set path that
is not a file, throws the sentence that says what is missing and what to do.
*/
export function resolveSerialInterpreter(probe: SerialInterpreterProbe): string {
  if (probe.configured !== undefined && probe.configured !== '') {
    const given = probe.configured
    const platformPath = probe.platform === 'win32' ? path.win32 : path.posix
    if (!platformPath.isAbsolute(given) || !probe.fileExists(given))
      throw new Error(UI_TEXT.makerSerialPythonSetMissing)
    if (isInWorkspace(probe, given)) throw new Error(UI_TEXT.makerSerialPythonSetInWorkspace)
    return given
  }
  const scope = { workspaceRoot: probe.workspaceRoot, realpath: probe.realpath }
  const found = resolveAllExecutables('python3', {
    platform: probe.platform,
    pathVariable: environmentValue(probe.env, probe.platform, 'PATH'),
    fileExists: probe.fileExists,
    scope,
  }).find((candidate) => !isWorkspacePath(probe.platform, scope, candidate))
  if (found === undefined) throw new Error(UI_TEXT.makerSerialPythonMissing)
  return found
}
