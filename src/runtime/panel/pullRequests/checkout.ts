// Node's git processes for the runtime's git calls: explicit argument
// arrays, no shell, hidden windows. The native-defaults test pins these.
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { PullRequestServiceError } from './pullRequests'
import { redactSecrets } from '../../../core/redact'

/** How git runs to completion: options for one process. */
export interface GitRunOptions {
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly signal: AbortSignal
  readonly timeout: number
  readonly maxBuffer: number
}

/** How the batch child starts. */
export interface GitStartOptions {
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly signal: AbortSignal
  readonly timeout: number
  /** Its own process group on POSIX. */
  readonly detached: boolean
}

/**
 * How git processes start: node's, or a test's that records each start.
 * Both start the process before they return.
 */
export interface GitProcessPort {
  /** Runs to completion; resolves with the standard output. */
  run(file: string, args: readonly string[], options: GitRunOptions): Promise<string>
  /** Starts with piped standard streams. */
  start(
    file: string,
    args: readonly string[],
    options: GitStartOptions,
  ): ChildProcessWithoutNullStreams
}

/** Node's processes: explicit argument arrays, no shell, hidden windows. */
export const nodeGitProcesses: GitProcessPort = {
  run: (file, args, options) =>
    new Promise<string>((resolve, reject) => {
      execFile(file, [...args], { ...options, windowsHide: true }, (error, stdout) => {
        if (error === null) {
          resolve(stdout)
          return
        }
        reject(error instanceof Error ? error : new PullRequestServiceError(failureText(error)))
      })
    }),
  start: (file, args, options) => spawn(file, [...args], { ...options, windowsHide: true }),
}

function failureText(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error))
}
