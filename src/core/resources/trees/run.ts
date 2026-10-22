import { type GuardedChildEnv } from '../../executables'
import { execFileGuarded } from '../../guardedChildProcess'

export type ResourceTreeRun = (
  file: string,
  args: readonly string[],
  env: GuardedChildEnv,
) => Promise<string>

/** Share one in-flight OS table across concurrent trees; never retain an action-time table. */
export function coalescedTreeRead<T>(read: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined
  return async () => {
    const current = (pending ??= read())
    try {
      return await current
    } finally {
      if (pending === current) pending = undefined
    }
  }
}

/**
A probe runner with, when given, its caller's own time bound and output
bound; with no time bound the probe runs until it exits.
*/
export function boundedTreeProgram(timeoutMs?: number, maxBuffer?: number): ResourceTreeRun {
  return (file, args, env) =>
    new Promise((resolve, reject) => {
      execFileGuarded(
        file,
        [...args],
        {
          env,
          windowsHide: true,
          ...(timeoutMs !== undefined && { timeout: timeoutMs }),
          ...(maxBuffer !== undefined && { maxBuffer }),
        },
        (error, stdout, stderr) => {
          // A native refusal keeps its bounded stderr on the rejection, so
          // the caller reads what the helper said, never a bare signal.
          if (error === null) resolve(stdout)
          else reject(Object.assign(new Error(error.message, { cause: error }), { stderr }))
        },
      )
    })
}

/**
Probes inherit no credential variables and run only absolute OS/helper
paths. No deadline of ours: a cold Windows PowerShell start can take
longer than any bound, and killing it failed the work it served.
*/
export const runTreeProgram: ResourceTreeRun = boundedTreeProgram()
