// The shapes every team worker shares (M96 lane W, PLAN.md D75): the task a
// worker runs, the role policy that binds it, and the tunables the plan
// names. Lanes R (roles), A (pools) and T (tools) own the richer versions of
// these shapes (`src/shared/team.ts`, the charter, the roster); this file
// holds only what the workers need to run, as an explicit seam, so lane W
// builds and tests without waiting for them.
//
// Lane 0 owns the `TEAM_*` region of `src/shared/constants.ts`. The
// `WORKER_*` names below carry the plan's values until lane 0 relocates them;
// nothing here is a second source of a value lane 0 already set.

/** A job a role can do (D75's built-in roles). */
export type WorkerRoleId =
  'research' | 'design' | 'marketing' | 'engineering' | 'qa' | 'code-review' | 'docs'

/** Where a worker may write (D75's workspace modes). */
export type WorkerWorkspaceMode = 'read-only' | 'own-branch' | 'in-place'

/** The tool groups D75 defines, in the Model API's names. */
export type WorkerToolGroup =
  | 'read'
  | 'codeIntel'
  | 'rename'
  | 'write'
  | 'shell'
  | 'readOnlyShell'
  | 'testShell'
  | 'checks'
  | 'diagnostics'
  | 'webFetch'
  | 'webSearch'
  | 'images'
  | 'memoryRead'
  | 'skills'
  | 'report'

/** The report a role hands back (D75's `report` key). */
export type WorkerReportShape = 'summary' | 'review' | 'qa'

/**
 * The role policy a worker runs under. Lane R resolves this from the role's
 * `AGENT.md` keys; lane W takes it as given and enforces it.
 */
export interface WorkerRolePolicy {
  readonly roleId: WorkerRoleId
  readonly workspaceMode: WorkerWorkspaceMode
  /** The role's tool groups, already met with the session and the paid gates. */
  readonly toolGroups: readonly WorkerToolGroup[]
  /** Globs a writer may change; absent means the tools decide. */
  readonly writePaths?: readonly string[]
  /** Roles this role may delegate to; absent or empty means none. */
  readonly delegates?: readonly string[]
  readonly reportShape: WorkerReportShape
}

/** One delegation a worker executes. */
export interface WorkerTask {
  readonly taskId: string
  readonly roleId: WorkerRoleId
  /** The orchestrator's instruction; capped at `WORKER_BRIEF_MAX_CHARS`. */
  readonly brief: string
  /** The task's branch (`agents/<role>/<task-id>`), named with the brief. */
  readonly branch: string
  /**
   * The folder the worker runs in: its working copy, or a scratch copy for
   * a `read-only` role. Lane I creates it; lane W never runs elsewhere.
   */
  readonly folder: string
  /** Files named as paths; small text files are inlined up to the byte cap. */
  readonly files: readonly string[]
}

/** The parts of a worker's prompt, in the order D75 lists them. */
export interface WorkerPromptParts {
  /** The role's generated charter (lane R), cache-stable across tasks. */
  readonly charter: string
  /** The role's body: the user's guidance. */
  readonly body: string
  /** The workspace's rules and skills, as the worker's backend loads them. */
  readonly rulesAndSkills: string
}

/** A worker's kind, by who runs its tools (D75's words). */
export type WorkerKind = 'engine' | 'museCode' | 'external'

/** A worker's report fence tag: `muse-team-report` (D75). */
export const WORKER_REPORT_FENCE = 'muse-team-report'

/** A review task's findings fence tag: M70's `muse-review` (acceptance 18). */
export const WORKER_REVIEW_FENCE = 'muse-review'
