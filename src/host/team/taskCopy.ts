// The copy a team task works in, from its start to its hand-back (M96 lanes
// W and I; RLF-TEAMWORKERS): every worker kind (engine, Muse Code, external)
// runs in a task copy of the repository the same way. `own-branch` is a
// shared clone on `agents/<role>/<task-id>`, `read-only` a detached scratch
// copy. The extension commits the branch at the end and publishes the
// `agents/` ref; only the orchestrator's `merge` writes the user's tree.

import { mkdir, realpath } from 'node:fs/promises'
import { TEAM_MODEL_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { TeamReport, TeamUsage } from '../../shared/team'
import { builtinRoles } from '../../core/team/builtInRoles'
import type { TeamGit } from '../../core/team/teamGit'
import {
  commitTaskBranch,
  publishTaskRef,
  removeTeamWorkspace,
  resolveBaseCommit,
  scratchBreach,
  startTeamWorkspace,
} from '../../core/team/teamWorkspaces'
import type { TeamTaskSpec, TeamWorkerOutcome } from '../../core/team/teamHostService'

export interface TaskCopyDeps {
  readonly runGit: TeamGit
  readonly platform: NodeJS.Platform
  /** The user's repository: the workspace folder; undefined without one. */
  readonly repositoryRoot: () => string | undefined
  /** The extension's own storage for this workspace: copies live under `agents/`. */
  readonly storageRoot: string
}

/** A task's copy as the start left it. */
export interface TaskCopy {
  readonly repositoryRoot: string
  readonly builtin: ReturnType<typeof builtinRoles>[number] | undefined
  readonly mode: 'read-only' | 'own-branch'
  readonly previous: TeamWorkerOutcome | undefined
  readonly baseCommit: string
  readonly workspace: {
    readonly folder: string
    readonly branch?: string | undefined
    readonly agentsRef?: string | undefined
  }
  /** False for a reopened task: its copy stays with the finished task it came from. */
  readonly isNewCopy: boolean
}

/** The user's repository, or the sentence saying the workspace has none. */
export function requireRepository(deps: Pick<TaskCopyDeps, 'repositoryRoot'>): string {
  const root = deps.repositoryRoot()
  if (root === undefined) throw new Error(TEAM_MODEL_TEXT.hostNoRepository)
  return root
}

/**
The storage root as the file system resolves it: a linked profile or a
temporary folder behind a link (macOS's /var) is admitted by its real path,
which the copies' fence compares against. Memoised, retried after a failure.
*/
export function canonicalStorage(storageRoot: string): () => Promise<string> {
  let canonical: Promise<string> | undefined
  return async () => {
    canonical ??= (async () => {
      await mkdir(storageRoot, { recursive: true })
      return await realpath(storageRoot)
    })()
    try {
      return await canonical
    } catch (error: unknown) {
      canonical = undefined
      throw error
    }
  }
}

/**
Resolves the task's role, mode and base, and makes (or reopens) its copy.
A role outside the built-ins must carry its own full definition; `in-place`
is not offered to team workers.
*/
export async function beginTaskCopy(
  deps: TaskCopyDeps,
  storage: () => Promise<string>,
  spec: TeamTaskSpec,
): Promise<TaskCopy> {
  const repositoryRoot = requireRepository(deps)
  const builtin = builtinRoles().find((role) => role.id === spec.role.role)
  if (
    builtin === undefined &&
    (spec.role.purpose?.trim() === undefined ||
      spec.role.purpose.trim() === '' ||
      spec.role.workspace === undefined ||
      spec.role.tools === undefined ||
      spec.role.report === undefined)
  ) {
    throw new Error(fill(TEAM_MODEL_TEXT.hostRoleNotOffered, { role: spec.role.role }))
  }
  // A review reads the reviewed branch at its head, in a scratch copy.
  const reviewed = spec.reviewOf
  const mode =
    reviewed === undefined
      ? (spec.role.workspace ?? builtin?.workspace ?? 'read-only')
      : 'read-only'
  if (mode === 'in-place') throw new Error(TEAM_MODEL_TEXT.hostInPlaceNotOffered)
  const previous = spec.continueFrom
  const baseCommit =
    reviewed?.head ?? previous?.baseCommit ?? (await resolveBaseCommit(deps.runGit, repositoryRoot))
  const workspace =
    previous?.folder === undefined
      ? await startTeamWorkspace(deps.runGit, await storage(), deps.platform, {
          repositoryRoot,
          role: spec.role.role,
          taskId: spec.taskId,
          mode,
          baseCommit,
        })
      : { folder: previous.folder, branch: previous.branch, agentsRef: previous.agentsRef }
  return {
    repositoryRoot,
    builtin,
    mode,
    previous,
    baseCommit,
    workspace,
    isNewCopy: previous?.folder === undefined,
  }
}

/**
Hands the copy back: a read-only copy is checked for a breach and removed;
a writer's branch is committed, its `agents/` ref published, and the files
it changed listed against its base.
*/
export async function endTaskCopy(
  deps: TaskCopyDeps,
  storage: () => Promise<string>,
  input: {
    readonly spec: TeamTaskSpec
    readonly copy: TaskCopy
    readonly signal: AbortSignal
    readonly report: TeamReport
    readonly isCeilingReached: boolean
    readonly usage: TeamUsage
  },
): Promise<TeamWorkerOutcome> {
  const { spec, copy, signal, report, usage, isCeilingReached } = input
  const { workspace, repositoryRoot, baseCommit, previous } = copy
  if (copy.mode === 'read-only') {
    const breach = await scratchBreach(deps.runGit, workspace.folder)
    await removeTeamWorkspace(deps.runGit, repositoryRoot, await storage(), workspace.folder)
    await spec.meter.noteWorkspace(undefined)
    return {
      isCeilingReached,
      report:
        breach.length === 0
          ? report
          : {
              status: 'failed',
              summary: `${TEAM_MODEL_TEXT.hostReadOnlyBreach} ${breach.join(', ')}`,
            },
      usage,
    }
  }
  const branch = workspace.branch ?? ''
  const before = previous?.head ?? baseCommit
  const committed = await commitTaskBranch(deps.runGit, workspace.folder, {
    branch,
    role: spec.role.role,
    taskId: spec.taskId,
    entryId: spec.entry.id,
  })
  if (committed.committed && workspace.agentsRef !== undefined) {
    await publishTaskRef(
      deps.runGit,
      repositoryRoot,
      workspace.folder,
      branch,
      workspace.agentsRef,
      before,
    )
  }
  const changed = new TextDecoder()
    .decode(
      await deps.runGit(
        ['diff', '--name-only', '-z', '--no-renames', baseCommit, committed.head, '--'],
        workspace.folder,
      ),
    )
    .split('\0')
    .filter((name) => name !== '')
  signal.throwIfAborted()
  return {
    isCeilingReached,
    report,
    usage,
    branch,
    baseCommit,
    head: committed.head,
    changedFiles: changed,
    folder: workspace.folder,
    agentsRef: workspace.agentsRef,
  }
}

/**
Best-effort removal of a copy the task made but never handed back. A
failure warns with fixed words (never the raw error) and stays silent
otherwise: the caller's handler already rethrows the task's own failure. A
reopened task's copy stays with the finished task it came from.
*/
export async function removeUnreturnedCopy(
  deps: TaskCopyDeps,
  storage: () => Promise<string>,
  input: {
    readonly spec: TeamTaskSpec
    readonly copy: TaskCopy
    readonly warn: (message: string) => void
  },
): Promise<void> {
  const { spec, copy } = input
  if (!copy.isNewCopy) return
  try {
    await removeTeamWorkspace(
      deps.runGit,
      copy.repositoryRoot,
      await storage(),
      copy.workspace.folder,
      copy.workspace.agentsRef,
    )
    await spec.meter.noteWorkspace(undefined)
  } catch {
    input.warn(`Team task ${spec.taskId}: its cleanup or recovery record could not be completed`)
  }
}
