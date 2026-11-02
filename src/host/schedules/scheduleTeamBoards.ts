// The window's team boards for role/team schedule targets (C-M115-8):
// this window's workspace while schedules stay active, through the
// window's team host binding.
import path from 'node:path'
import { workspaceKey } from '../../runtime/dataFolder'
import { UI_TEXT } from '../../shared/constants'
import type { ScheduleTeamBoards } from '../../core/schedules/boardDelivery'
import type {
  ScheduledBoardTaskInput,
  ScheduledBoardTaskOutcome,
} from '../../core/team/teamHostService'

const unavailable = () => ({
  admitted: false as const,
  reason: UI_TEXT.scheduleV2.messages.targetUnavailable,
})

/**
Resolves only this window's own workspace while schedules stay active.
A team lost between resolve and admit refuses; it never fails the fire.
*/
export function createScheduleTeamBoards(options: {
  readonly workspaceRoot: string | undefined
  readonly isActive: () => boolean
  readonly admit: (input: ScheduledBoardTaskInput) => Promise<ScheduledBoardTaskOutcome | undefined>
}): ScheduleTeamBoards {
  return {
    teamFor: (key) =>
      Promise.resolve(
        options.workspaceRoot === undefined ||
          key !== workspaceKey(path.resolve(options.workspaceRoot)) ||
          !options.isActive()
          ? undefined
          : {
              admit: async (input) => {
                if (!options.isActive()) return unavailable()
                const outcome = await options.admit({
                  ...(input.roleId !== undefined && { roleId: input.roleId }),
                  brief: input.brief,
                  boardKey: input.boardKey,
                  parentSessionId: input.parentSessionId,
                  paidCapUsd: input.paidCapUsd,
                  paidConsented: input.paidConsented,
                })
                return outcome ?? unavailable()
              },
            },
      ),
  }
}
