// The team runner's playbook integration (M116, PLAN.md D212): a real
// policy over the workspace journal, scoped to the team runner's team,
// with the board read from the team's live facts. It lives in the
// window's playbook bundle, beside the panel governor, so the policy
// ships once and activation carries none of it.
//
// The team integration runs git reads, never shell hooks, through the
// policy: beginWork records the dispatch baseline from the workspace, and
// launched work is released, never verified, when the task ends. Trust is
// gated by the caller (delegate refuses untrusted workspaces before the
// start); the check admission is the host's own capacity (D213). The reads
// spawn synchronously in-process and complete in milliseconds with no kill
// path, so they take no Windows job (spawnSync reaps; the job exists for
// the worker's killable calls).
import { FilePlaybookJournal } from '../../core/orchestration/playbook/journal'
import {
  OrchestratorPlaybook,
  type PlaybookCheckAdmission,
} from '../../core/orchestration/playbook/policy'
import {
  PlaybookIntegration,
  type PlaybookIntegrationEvents,
} from '../../core/orchestration/playbookIntegration'
import {
  teamPlanPort,
  type TeamPlaybookBranchState,
  type TeamPlaybookCiState,
  type TeamPlaybookEntryState,
} from '../../core/team/teamPlaybookBoard'
import type { PlaybookLane } from '../../shared/playbook'

export interface TeamPlaybookIntegrationDeps {
  readonly agentDataFolder: string
  readonly workspaceFolder: string
  readonly teamId: string
  readonly laneId: string
  /** The host's own capacity (D213): the panel's fail-closed port stays the panel's. */
  readonly checkAdmission: PlaybookCheckAdmission
  /** The plan binding's lanes (M113's lanes tables); empty until it lands. */
  readonly lanes: () => readonly PlaybookLane[]
  /** The team's live entry worker states, from the team host. */
  readonly entries: () => readonly TeamPlaybookEntryState[]
  /** The team's live task branches with their merge state, from the team host. */
  readonly branches: () => readonly TeamPlaybookBranchState[]
  /** Whether the repository really has CI (M113's CI check runs); unknown never reads true. */
  readonly ci: () => TeamPlaybookCiState
  readonly events: PlaybookIntegrationEvents
  readonly now?: () => number
}

export function createTeamPlaybookIntegration(
  deps: TeamPlaybookIntegrationDeps,
): PlaybookIntegration {
  const policy = new OrchestratorPlaybook({
    journal: new FilePlaybookJournal(deps.agentDataFolder, deps.workspaceFolder),
    teamId: deps.teamId,
    laneId: deps.laneId,
    workspaceFolder: deps.workspaceFolder,
    now: deps.now ?? Date.now,
    // A model-driven delegate call never carries a user's override decision.
    authorizeOverride: () => false,
    // No lane merges run through this integration; the planner binding
    // supplies the guard inventory with the task-to-lane map.
    drillRequirements: { guards: () => [] },
    checkAdmission: deps.checkAdmission,
    hookAdmission: { admit: (effect) => effect.kind === 'git' },
  })
  return new PlaybookIntegration(
    policy,
    teamPlanPort(() => ({
      lanes: deps.lanes(),
      entries: deps.entries(),
      branches: deps.branches(),
      ci: deps.ci(),
    })),
    deps.events,
  )
}
