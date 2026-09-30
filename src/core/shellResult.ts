// Shared process result only: eager host adapters must not load the Model API tools bundle.

export interface ShellResult {
  /** Local caller admission refused before native entry; never inferred from output or cancellation. */
  readonly isEntryRefused?: true
  /**
   * Locally owned process provenance only: every workspace-capable descendant
   * is positively observed stopped. Exit code/pipe close/drain never qualifies.
   * Current runners provide no such proof; never read this from model/MSP data.
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
