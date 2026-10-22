/** The shared git-call contract between the team workers, workspaces and merge (M96, D75). This module is a leaf: it imports nothing from the team graph, so the dead-code and cycle gates see every use. */

/** git ended non-zero: the code and what it said. */
export class TeamGitError extends Error {
  public constructor(
    public readonly exitCode: number,
    public readonly stderr: string,
    command: string,
    options?: { cause?: unknown },
  ) {
    super(`git ${command} exited with code ${String(exitCode)}: ${stderr.trim()}`, options)
    this.name = 'TeamGitError'
  }
}

export function isTeamGitError(value: unknown): value is TeamGitError {
  return (
    value instanceof Error &&
    value.name === 'TeamGitError' &&
    'exitCode' in value &&
    typeof value.exitCode === 'number' &&
    Number.isSafeInteger(value.exitCode)
  )
}

/**
One git command's stdout as bytes (binary-safe for blobs); rejects with
`TeamGitError` on a non-zero exit. The host adapts its git process to
this; tests run real git through `execFile`. The adapter MUST honour an
explicit environment: automatic worker-copy calls supply credential-free
`workerEnvironment`, never the host's inherited environment.
*/
export type TeamGit = (
  args: readonly string[],
  cwd: string,
  input?: string,
  env?: NodeJS.ProcessEnv,
) => Promise<Uint8Array>
