// Editor ports for the portable U1 draft. The factory stays in dist/teamPanel.js.
import type { TeamPanelController, TeamPanelDeps } from '../../core/team/teamPanel'
import type { TeamStatePort } from '../../core/team/teamHostService'
import type { TeamTreeData } from '../../shared/teamView'
import type { TeamSurfaceMessage } from '../teamHostBinding'
import type { TeamPanelMessage } from '../../shared/teamPanel'

export interface TeamPanelBinding {
  readonly dryRun?: TeamPanelDeps['dryRun']
  readonly configuration?: Pick<
    TeamPanelDeps,
    'offers' | 'defaultRef' | 'maxWorkers' | 'confirmOrchestrator' | 'dryRun'
  >
  readonly snapshots?: Pick<TeamPanelDeps, 'remainingDailyBudgetUsd' | 'records'>
  readonly isEnabled: () => boolean
  readonly state: TeamStatePort
  readonly reload: () => void
  readonly onTreeChange: (listener: () => void) => () => void
  readonly tree: () => TeamTreeData | undefined
  readonly handle: (message: TeamSurfaceMessage) => Promise<void>
}
export interface TeamPanelHost {
  readonly load: () => Promise<TeamPanelController | undefined>
  readonly onTreeChange: (listener: () => void) => () => void
  readonly tree: () => TeamTreeData | undefined
  readonly handle: (message: TeamSurfaceMessage) => Promise<void>
}
export function teamAction(message: TeamPanelMessage): TeamSurfaceMessage | undefined {
  switch (message.type) {
    case 'agents/stopTask': {
      return { type: 'stopTeamTask', taskId: message.taskId }
    }
    case 'agents/stopAll': {
      return { type: 'stopAllTeamTasks' }
    }
    case 'agents/resetEntry': {
      return { type: 'resetTeamEntry', entryId: message.entryId }
    }
    case 'agents/transcript': {
      return { type: 'openTeamTaskTranscript', taskId: message.taskId }
    }
    case 'agents/diff': {
      return { type: 'reviewTeamDiff', taskId: message.taskId }
    }
    case 'agents/merge': {
      return { type: 'decideTeamMerge', taskId: message.taskId, decision: message.decision }
    }
    default: {
      return undefined
    }
  }
}
