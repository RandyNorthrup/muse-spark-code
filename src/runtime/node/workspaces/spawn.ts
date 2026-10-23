// Split an execFile callback (M110b W2): exits — even failing ones —
// resolve with their code and output; only a spawn failure (no code
// at all) rejects, typed by the caller. One shape for the git and
// devcontainer runners, so the tool boundary stays visibly the same
// everywhere a workspace runs a binary.
import type { ExecFileException } from 'node:child_process'

/** A finished run: its exit code with the output that came with it. */
export interface ExecExit {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/** A settled callback: either the exit, or the raw failure of a child that never ran. */
export type SettledExecFile =
  { readonly exited: ExecExit } | { readonly spawnFailed: ExecFileException }

/**
Settle the callback: `exited` for every exit a code describes,
`spawnFailed` (the raw failure, for the caller's typed error) for the
rest — a binary that never started has no code to carry.
*/
export function settleExecFile(
  error: ExecFileException | null,
  stdout: string,
  stderr: string,
): SettledExecFile {
  if (error === null) return { exited: { exitCode: 0, stdout, stderr } }
  const code: unknown = 'code' in error ? error.code : undefined
  return typeof code === 'number'
    ? { exited: { exitCode: code, stdout, stderr } }
    : { spawnFailed: error }
}

/**
Build the execFile callback: every exit resolves with its code and
output; a spawn failure rejects with the caller's typed error, built
from the raw failure and whatever output came with it. One settlement
for every runner — the callback runs after the executor returns, so it
resolves and rejects instead of throwing.
*/
export function execCallback(
  resolve: (exit: ExecExit) => void,
  reject: (error: Error) => void,
  makeError: (cause: ExecFileException, stdout: string, stderr: string) => Error,
): (error: ExecFileException | null, stdout: string, stderr: string) => void {
  return (error, stdout, stderr) => {
    const settled = settleExecFile(error, stdout, stderr)
    if ('spawnFailed' in settled) {
      reject(makeError(settled.spawnFailed, stdout, stderr))
      return
    }
    resolve(settled.exited)
  }
}
