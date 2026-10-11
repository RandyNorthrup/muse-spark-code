import { execFile } from 'node:child_process'
import { PROCESS_TABLE_TIMEOUT_MS } from '../../../shared/constants'

export type ResourceTreeRun = (
  file: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
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

/** Probes inherit no credential variables and run only absolute OS/helper paths. */
export const runTreeProgram: ResourceTreeRun = (file, args, env) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { env: env ?? { LC_ALL: 'C' }, windowsHide: true, timeout: PROCESS_TABLE_TIMEOUT_MS },
      (error, stdout) => {
        if (error === null) resolve(stdout)
        else reject(new Error(error.message, { cause: error }))
      },
    )
  })
