import { type GuardedChildEnv } from '../../executables'
import { noWorkspaceChildEnvironment } from '../../execGuard'
import { realpathSync } from 'node:fs'
import { PROCESS_TABLE_TIMEOUT_MS } from '../../../shared/constants'
import { execFileGuarded } from '../../guardedChildProcess'

export type ResourceTreeRun = (
  file: string,
  args: readonly string[],
  env: GuardedChildEnv,
) => Promise<string>

/**
 * The guarded environment for a fixed absolute probe (`/bin/ps`,
 * `/usr/bin/getconf`, the compiled tree helpers, SystemRoot PowerShell):
 * absolute PATH entries only, links followed — never a PATH search, so a
 * planted program never runs. The call sites name this form explicitly
 * instead of leaving the environment unguarded.
 */
export function probeChildEnvironment(env: NodeJS.ProcessEnv): GuardedChildEnv {
  return noWorkspaceChildEnvironment(process.platform, env, realpathSync)
}

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
    execFileGuarded(
      file,
      [...args],
      { env, windowsHide: true, timeout: PROCESS_TABLE_TIMEOUT_MS },
      (error, stdout) => {
        if (error === null) resolve(stdout)
        else reject(new Error(error.message, { cause: error }))
      },
    )
  })
