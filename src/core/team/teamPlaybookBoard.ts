// The team runner's playbook board (M116, PLAN.md D212): readBoard from real
// team facts. Workers are the team's entry worker states, available when the
// worker is idle (nothing running on its entry) and admitted (the entry is
// usable), under the entry ids the offloading caller addresses, so
// beforeCheck's pick names a worker the offloader can use. A prerequisite
// counts as merged only when its branch is merged into the integration
// target. CI reads from the facts' tri-state: unknown is never true.
// Lanes ride through from the plan binding (M113's lanes tables); the team
// runner passes what its plan binding has. Pure: no vscode, no journal.
import { bounded, moduleKeyOf } from '../orchestration/panelLanes'
import type { PlaybookWork } from '../orchestration/playbookIntegration'
import type { PlaybookBoard, PlaybookLane, PlaybookPlanPort } from '../../shared/playbook'

/** One pool entry's live worker state, as the team host reads it. */
export interface TeamPlaybookEntryState {
  readonly id: string
  /** Admitted slots on the entry, including pending consent and teardown. */
  readonly running: number
  /** The entry can run at all (its worker exists, is loaded, may bill). */
  readonly usable: boolean
}

/** One task branch's merge state against the integration target. */
export interface TeamPlaybookBranchState {
  readonly branch: string
  readonly mergedIntoTarget: boolean
}

/** Whether the repository really has CI (M113's CI check runs). Unknown is
never true: the board reads false until CI is known present. */
export type TeamPlaybookCiState =
  { readonly known: true; readonly hasCi: boolean } | { readonly known: false }

export interface TeamPlaybookFacts {
  readonly lanes: readonly PlaybookLane[]
  readonly entries: readonly TeamPlaybookEntryState[]
  readonly branches: readonly TeamPlaybookBranchState[]
  readonly ci: TeamPlaybookCiState
}

export function teamPlaybookBoard(facts: TeamPlaybookFacts): PlaybookBoard {
  const seenEntries = new Set<string>()
  const workers = facts.entries
    .filter((entry) => {
      if (seenEntries.has(entry.id)) return false
      seenEntries.add(entry.id)
      return true
    })
    .map((entry) => ({ id: entry.id, available: entry.running === 0 && entry.usable }))
  const seenBranches = new Set<string>()
  const mergedPrerequisites = facts.branches
    .filter((branch) => {
      if (!branch.mergedIntoTarget || seenBranches.has(branch.branch)) return false
      seenBranches.add(branch.branch)
      return true
    })
    .map((branch) => branch.branch)
  return {
    lanes: facts.lanes,
    mergedPrerequisites,
    workers,
    hasCi: facts.ci.known && facts.ci.hasCi,
  }
}

/** Read the board live: every lookup sees the team's current facts. */
export function teamPlanPort(read: () => TeamPlaybookFacts): PlaybookPlanPort {
  return { readBoard: () => teamPlaybookBoard(read()) }
}

/** A dispatched team task, as the host recorded it. Facts only: the brief,
// files and reason are the admitted task record's, never prompt text. */
export interface TeamPlaybookTask {
  readonly taskId: string
  readonly brief: string
  readonly files: readonly string[]
  readonly reasonCode: string
  readonly reasonDetail: string
  readonly sessionId: string
  readonly teamId: string
}

/** A detached checkout has no branch: its work records against the branch namespace. */
const DETACHED_REFS = 'refs/heads'

/**
The dispatch work for one team task: its own module (source `team`), the
task record's brief, and the repository HEAD the copy branches from. A task
with no files touches no module and is ungoverned: undefined, and the
caller runs it exactly as before.
*/
export function teamPlaybookWork(
  task: TeamPlaybookTask,
  head: { readonly ref: string | undefined; readonly commit: string },
): PlaybookWork | undefined {
  const files = task.files.map((file) => file.replaceAll('\\', '/'))
  const [first] = files
  if (first === undefined) return undefined
  return {
    id: bounded(task.taskId),
    module: {
      id: bounded(`team:${task.taskId}`),
      key: moduleKeyOf(first),
      files,
      source: 'team',
    },
    refs: [head.ref ?? DETACHED_REFS],
    requester: { agentId: bounded(`team:${task.sessionId}`), teamId: task.teamId },
    brief: {
      objective: task.brief,
      scope: [...files],
      acceptance: [`${task.reasonCode}: ${task.reasonDetail}`],
      baseCommit: head.commit,
    },
    commands: [],
  }
}
