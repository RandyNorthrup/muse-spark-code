import { probeChildEnvironment } from '../../executables'
import { execFileGuarded } from '../../guardedChildProcess'

/** The fixed starts the local judge makes: bounded text runs, never a shell. */
export interface GuardedExecOptions {
  readonly env?: NodeJS.ProcessEnv | undefined
  readonly signal?: AbortSignal | undefined
  readonly timeout?: number | undefined
  readonly maxBuffer?: number | undefined
  readonly windowsHide?: boolean | undefined
}

/**
Runs `file` to its end through the guarded wrapper: the caller's env is
branded to the child env here, so call sites keep their exact shape (an
empty env, a SystemRoot-only env, the pull's fixed keys) and PATHGUARD
sees no direct start. Resolves `{ stdout, stderr }` like promisified
execFile; a failure rejects with its message and the exec failure as the
cause.
*/
export function executeGuarded(
  file: string,
  args: readonly string[],
  options: GuardedExecOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileGuarded(
      file,
      args,
      {
        env: probeChildEnvironment(options.env ?? {}),
        signal: options.signal,
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
        windowsHide: options.windowsHide,
      },
      (error, stdout, stderr) => {
        if (error === null) resolve({ stdout, stderr })
        else reject(new Error(error.message, { cause: error }))
      },
    )
  })
}
