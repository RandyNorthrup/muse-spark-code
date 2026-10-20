import { type GuardedChildEnv } from '../../executables'
import { PROCESS_TABLE_TIMEOUT_MS } from '../../../shared/constants'
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

/** A probe runner with its own time bound and, when given, an output bound. */
export function boundedTreeProgram(timeoutMs: number, maxBuffer?: number): ResourceTreeRun {
  return (file, args, env) =>
    new Promise((resolve, reject) => {
      execFileGuarded(
        file,
        [...args],
        {
          env,
          windowsHide: true,
          timeout: timeoutMs,
          ...(maxBuffer !== undefined && { maxBuffer }),
        },
        (error, stdout) => {
          if (error === null) resolve(stdout)
          else reject(new Error(error.message, { cause: error }))
        },
      )
    })
}

/** Probes inherit no credential variables and run only absolute OS/helper paths. */
export const runTreeProgram: ResourceTreeRun = boundedTreeProgram(PROCESS_TABLE_TIMEOUT_MS)
