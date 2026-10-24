// A workspace binary through the governed boundary (M110b W2, PATHGUARD):
// the command resolves outside the workspace it runs in, the child gets
// the guarded environment, admission and containment as every governed
// start. Exits — even failing ones — resolve with their code and output;
// only a run that never exited rejects, typed by the caller. One shape
// for the git and devcontainer runners, so the tool boundary stays
// visibly the same everywhere a workspace runs a binary.
import { isGovernedCommandExit, isGovernedCommandFailure } from '../../../core/resources/launch'
import { execResourceFile } from '../../../core/resources/launcher'

/** A finished run: its exit code with the output that came with it. */
export interface ExecExit {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/**
Run `file` in `cwd` (the workspace it guards): every exit a code
describes resolves with its code and output, as execFile's callback
did; a run that never exited (no such command outside the workspace, a
start failure, the governor's refusal, a stop, its output bound) rejects
with the caller's typed error, built from the cause and whatever stderr
came with it. Without `maxBuffer` the boundary's own bound applies, the
size of execFile's default.
*/
export async function runWorkspaceProcess(
  profile: 'contained' | 'probe',
  file: string,
  args: readonly string[],
  options: {
    readonly cwd: string
    readonly env: NodeJS.ProcessEnv
    readonly maxBuffer?: number | undefined
  },
  makeError: (cause: unknown, stderr: string) => Error,
): Promise<ExecExit> {
  try {
    const { stdout, stderr } = await execResourceFile(profile, file, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf8',
      ...(options.maxBuffer !== undefined && { maxBuffer: options.maxBuffer }),
    })
    return { exitCode: 0, stdout, stderr }
  } catch (error: unknown) {
    // NARROW: an exit with its code is a result, never a failure to run.
    if (isGovernedCommandExit(error))
      return { exitCode: error.code, stdout: error.stdout, stderr: error.stderr }
    throw makeError(error, isGovernedCommandFailure(error) ? error.stderr : '')
  }
}
