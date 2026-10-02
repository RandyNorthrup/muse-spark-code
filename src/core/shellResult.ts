// Shared process result only: eager host adapters must not load the Model API tools bundle.

export interface ShellResult {
  /** Local caller admission refused before native entry; never inferred from output or cancellation. */
  readonly isEntryRefused?: true
  /**
   * Locally owned process provenance only: no workspace-capable process exists
   * that could outlive the result. Only a command that could not start
   * (`unstartedShell`) or was refused before entry carries it; a launched
   * command never does, and exit code/pipe close/drain never qualify. Never
   * read this from model/MSP data.
   */
  readonly isWorkspaceShutdownProven?: true
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly isTimedOut: boolean
  /** Stopped because the turn was (the Stop button, PLAN.md D25). */
  readonly isCancelled: boolean
  /** The command exceeded its per-stream byte budget (M51 hooks). */
  readonly isOutputTooLarge?: boolean
}

/**
 * A command that could not start at all (no interpreter, no program): the
 * failure stays the caller's to report, and only this local fact, never a
 * normal exit, proves no process exists to outlive it.
 */
export function unstartedShell(stderr: string): ShellResult {
  return {
    stdout: '',
    stderr,
    exitCode: null,
    isTimedOut: false,
    isCancelled: false,
    isWorkspaceShutdownProven: true,
  }
}

/**
 * A failure before the command could enter (the checkpoint could not be
 * marked): no process exists and nothing ran, so a caller that would tell the
 * model what the user ran stays silent. Only a failure AFTER the command ran
 * is a plain Error.
 */
export class ShellEntryError extends Error {}

/** Proven no-entry outcome from a local caller guard, separate from a stopped running process. */
export function refusedShellEntry(): ShellResult {
  return {
    stdout: '',
    stderr: '',
    exitCode: null,
    isTimedOut: false,
    isCancelled: true,
    isWorkspaceShutdownProven: true,
    isEntryRefused: true,
  }
}
