// The Traffic view's host half (M96c lane V/X2): the live slice from the
// window scheduler's board and the dispatch behind every row action.
// Stop, Cancel and Reassign go through attempt retirement (acceptance 7);
// an attempt retirement cannot prove stays counted until the person's
// recorded decision (Continue anyway / Hand off anyway / Restart the
// team host). Loads with the runners bundle, on the first Traffic use.
import { UI_TEXT } from '../../shared/l10n/text'
import type { TrafficMessage, TrafficSlice } from '../../shared/modelsPanel'
import type { TeamSharedFile } from '../../shared/team'
import type { TeamHostService } from '../../core/team/teamHostService'
import { projectTeamTraffic } from './teamTrafficProjection'
import type { WindowHint } from './windowHints'

export interface TeamTrafficDispatchDeps {
  readonly service: TeamHostService
  readonly windowInstanceId: string
  readonly maxWorkers: () => number
  readonly isHostBusy: () => boolean
  readonly hints: () => Promise<readonly WindowHint[]>
  readonly sharedFiles: () => readonly TeamSharedFile[]
  readonly openWindow: (hint: WindowHint) => Promise<void>
}

/** Projects this window's live Traffic slice from its board and tree. */
export async function readTeamTraffic(deps: TeamTrafficDispatchDeps): Promise<TrafficSlice> {
  const projected = projectTeamTraffic(
    deps.service,
    deps.maxWorkers(),
    await deps.hints(),
    deps.sharedFiles(),
    deps.windowInstanceId,
  )
  return { ...projected, hostBusy: deps.isHostBusy() }
}

/** Runs one admitted Traffic action; modelsPanelTraffic re-checks first. */
export async function dispatchTeamTraffic(
  deps: TeamTrafficDispatchDeps,
  message: TrafficMessage,
): Promise<void> {
  const scheduler = deps.service.scheduler
  if (scheduler === undefined) throw new Error(UI_TEXT.teamTaskUnknown)
  switch (message.type) {
    case 'traffic/load': {
      return
    }
    case 'traffic/queue': {
      switch (message.action) {
        case 'pause': {
          await scheduler.pause()
          break
        }
        case 'resume': {
          await scheduler.resume()
          break
        }
        case 'pauseMerge': {
          await deps.service.setLandingPaused(true)
          break
        }
        case 'resumeMerge': {
          await deps.service.setLandingPaused(false)
          break
        }
        default: {
          throw new Error(UI_TEXT.teamTaskUnknown)
        }
      }
      return
    }
    case 'traffic/task': {
      switch (message.action) {
        case 'cancel': {
          await scheduler.retireAttempt(message.taskId, message.attempt)
          break
        }
        case 'hold':
        case 'release': {
          await scheduler.reschedule({
            task_ids: [message.taskId],
            hold: message.action === 'hold',
          })
          break
        }
        case 'priority': {
          await scheduler.reschedule({ task_ids: [message.taskId], priority: message.priority })
          break
        }
        case 'reassign': {
          await scheduler.reassignAttempt(message.taskId, message.attempt, message.entryId)
          break
        }
        case 'handOffAnyway': {
          await scheduler.handOffAnyway(message.taskId, message.attempt, message.entryId)
          break
        }
        case 'continueAnyway': {
          await scheduler.continueAnyway(message.taskId, message.attempt)
          break
        }
        case 'restartTeamHost': {
          await scheduler.restartTeamHost()
          break
        }
        default: {
          throw new Error(UI_TEXT.teamTaskUnknown)
        }
      }
      return
    }
    case 'traffic/recovery': {
      const taskId = message.recoveryId
      switch (message.action) {
        case 'takeOver': {
          if (!(await scheduler.takeoverBoard()))
            throw new Error(UI_TEXT.teamTrafficDetails.changedSinceOpened)
          break
        }
        case 'resume':
        case 'recover': {
          await scheduler.reopenInterrupted(taskId)
          await scheduler.resume()
          break
        }
        case 'discard': {
          await deps.service.decideMerge(taskId, 'discard')
          break
        }
        case 'stop': {
          await deps.service.stopTask(taskId)
          break
        }
        case 'keep': {
          break
        }
        default: {
          throw new Error(UI_TEXT.teamTaskUnknown)
        }
      }
      return
    }
    case 'traffic/merge': {
      if (message.action !== 'landNow') throw new Error(UI_TEXT.teamTaskUnknown)
      await deps.service.decideMerge(message.taskId, 'merge')
      return
    }
    case 'traffic/window': {
      const fresh = await deps.hints()
      const hint = fresh.find((row) => row.instanceId === message.otherWindowId)
      if (hint === undefined) throw new Error(UI_TEXT.teamTrafficDetails.changedSinceOpened)
      await deps.openWindow(hint)
      return
    }
    case 'traffic/cleanup': {
      await deps.service.cleanupAgentBranches(message.taskId)
      return
    }
    default: {
      throw new Error(UI_TEXT.teamTaskUnknown)
    }
  }
}
