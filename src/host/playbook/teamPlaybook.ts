// The team runner's playbook integration (M116, PLAN.md D218): a real
// policy over the workspace journal, scoped to the team runner's team, with
// the board read from the team's live facts. It runs on the window's
// playbook worker thread, beside the panel governor: the policy is
// synchronous and spawns git (on Windows only inside the worker's contained
// job), so it never runs on the extension host.
//
// The team integration runs git reads, never shell hooks, through the
// policy: beginWork records the dispatch baseline from the workspace, and
// launched work is released, never verified, when the task ends. Trust is
// gated by the caller (delegate refuses untrusted workspaces before the
// start); the check admission is the host's own capacity (D219).
import {
  createFileJournalPolicy,
  type PlaybookCheckAdmission,
} from '../../core/orchestration/playbook/policy'
import type { PlaybookHookAdmission } from '../../core/orchestration/playbook/outcomes'
import {
  PlaybookIntegration,
  type PlaybookIntegrationEvents,
} from '../../core/orchestration/playbookIntegration'
import { teamPlanPort, type TeamPlaybookFacts } from '../../core/team/teamPlaybookBoard'
import type { TeamPlaybookPort } from '../../core/team/teamHostService'
import type { ResourceStatus } from '../../shared/resources'
import { PlaybookRefusal, type PlaybookTeamWindow } from './playbookWindow'
import type { PlaybookTeamStart } from './workerProtocol'

export interface TeamPlaybookIntegrationDeps {
  readonly agentDataFolder: string
  readonly workspaceFolder: string
  readonly teamId: string
  readonly laneId: string
  /** The host's own capacity (D219): the panel's fail-closed port stays the panel's. */
  readonly checkAdmission: PlaybookCheckAdmission
  /** The worker's own: git admitted, and on Windows contained in its job. */
  readonly hookAdmission: PlaybookHookAdmission
  /** The team's board facts, read live on every lookup. */
  readonly facts: () => TeamPlaybookFacts
  readonly events: PlaybookIntegrationEvents
  readonly now?: () => number
}

export function createTeamPlaybookIntegration(
  deps: TeamPlaybookIntegrationDeps,
): PlaybookIntegration {
  const policy = createFileJournalPolicy(deps, {
    // A model-driven delegate call never carries a user's override decision.
    authorizeOverride: () => false,
    // No lane merges run through this integration; the planner binding
    // supplies the guard inventory with the task-to-lane map.
    drillRequirements: { guards: () => [] },
    checkAdmission: deps.checkAdmission,
    // Git reads only: the team runs no shell hook through its playbook.
    hookAdmission: {
      ...deps.hookAdmission,
      admit: (effect) => effect.kind === 'git' && deps.hookAdmission.admit(effect),
    },
  })
  return new PlaybookIntegration(policy, teamPlanPort(deps.facts), deps.events)
}

/** What only the window observes for the team's board (D218, D219): unknown never reads true. */
export interface TeamPlaybookReadings {
  readonly ci: PlaybookTeamStart['ci']
  /** The latest resource reading; undefined while unknown, which never pauses work. */
  readonly capacity: ResourceStatus | undefined
}

/**
The team host's side of its rounds (D218): each start goes to the window's
worker with the board facts the host read and the readings only the window
has. The policy's refusal is the task's answer; anything else is thrown on.
*/
export function teamPlaybookRounds(
  window: PlaybookTeamWindow,
  readings: () => TeamPlaybookReadings,
): Omit<TeamPlaybookPort, 'head'> {
  return {
    start: async (start) => {
      const { ci, capacity } = readings()
      try {
        const started = await window.teamStart({
          task: { ...start.task, files: [...start.task.files] },
          head: {
            commit: start.head.commit,
            ...(start.head.ref !== undefined && { ref: start.head.ref }),
          },
          entries: [...start.entries],
          branches: [...start.branches],
          ci,
          ...(capacity !== undefined && { capacity }),
        })
        return started === 'started' ? { started: true } : { briefInvalid: true }
      } catch (error: unknown) {
        if (error instanceof PlaybookRefusal) return { refused: error.note }
        throw error
      }
    },
    release: (taskId) => window.teamRelease(taskId),
  }
}
