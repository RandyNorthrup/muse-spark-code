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
}

/**
The POSIX serial helper's Python (`native/posix/serial.py` runs under it, with
pyserial from the person's install) as one absolute path found on the
absolute entries of PATH outside the run workspace, as `gh`, `git` and the
Linux recorders are found. A bare `python3` would let a program planted in a
relative or workspace PATH entry run in place of the interpreter (CC-WINRUNTEAM).
A hit whose real path lies inside the workspace (a link to a planted file) is
skipped as well. No python3 there throws the sentence that says what is missing
and what to do.
*/
export function resolveSerialInterpreter(probe: SerialInterpreterProbe): string {
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
