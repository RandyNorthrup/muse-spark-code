import {
  scheduleApprovalActionSchema,
  type ScheduleApprovalAction,
} from '../../../../src/shared/scheduleV2'
import type { ScheduleSessionPort } from '../../../../src/shared/scheduleV2'
import { SCHEDULE_ACTION_CLASSES } from '../../../../src/shared/constants'

/** Keeps pending requests visible, so an unattended test cannot quietly hang. */
export class FakeScheduleApprovalStream {
  readonly pending = new Map<string, ScheduleApprovalAction>()
  readonly decisions: { id: string; allow: boolean; ruleId?: string }[] = []
  constructor(readonly backend: ScheduleSessionPort['backend']) {}
  request(actionClass: ScheduleApprovalAction['class']): ScheduleApprovalAction {
    const action = scheduleApprovalActionSchema.parse({
      id: actionClass,
      class: actionClass,
      tool: actionClass,
      ...(actionClass === 'shell' && { command: 'npm test' }),
      paths: actionClass === 'edit' ? ['src/example.ts'] : [],
      requiresAsking: actionClass === 'requiresAsking',
      protectedPath: actionClass === 'protectedPath',
    })
    this.pending.set(action.id, action)
    return action
  }
  requestEveryClass(): readonly ScheduleApprovalAction[] {
    return SCHEDULE_ACTION_CLASSES.map((kind) => this.request(kind))
  }
  decide(id: string, isAllowed: boolean, ruleId?: string): void {
    if (!this.pending.delete(id)) throw new Error('Unknown approval request')
    this.decisions.push({ id, allow: isAllowed, ...(ruleId !== undefined && { ruleId }) })
  }
  assertSettled(): void {
    if (this.pending.size > 0) throw new Error('Scheduled approvals are still pending')
  }
}
