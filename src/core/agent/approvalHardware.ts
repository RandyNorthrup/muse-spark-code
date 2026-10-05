import type { AgentEvent, ApprovalSubject } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import { hardwareAction } from '../maker/guard/hardwareCommands'
import { isDeviceAction, isPhysicalTool, type ActionClass } from '../maker/guard/actionClass'

type ApprovalCard = Extract<AgentEvent, { type: 'approvalRequested' | 'approvalUpdated' }>

/** Shell argv is checked independently per stage, never flattened across command boundaries. */
export function approvalHardwareAction(subject: ApprovalSubject): ActionClass | undefined {
  if (isPhysicalTool(subject.toolName ?? '')) return 'actuate'
  if (subject.kind !== 'shell') return undefined
  const actions = [
    ...(subject.command === undefined ? [] : [hardwareAction(subject.command)]),
    ...(subject.stages ?? []).map((stage) => hardwareAction(stage.argv.join(' '))),
  ]
  return actions.includes('refused') ? 'refused' : actions.find((action) => isDeviceAction(action))
}

/** Every physical action has only approve once and reject, never a prefix/session grant. */
export function scrubHardwareApproval<T extends ApprovalCard>(event: T): T {
  const action =
    approvalHardwareAction(event.subject) ??
    (isPhysicalTool('toolName' in event ? event.toolName : '') ? 'actuate' : undefined)
  if (!isDeviceAction(action)) return event
  return {
    ...event,
    availableChoices: event.availableChoices.filter(
      (choice) =>
        choice.scope === 'once' &&
        (choice.decision === 'abort' ||
          choice.decision === 'deny' ||
          (action !== 'refused' && choice.decision === 'approved')),
    ),
    note: action === 'refused' ? UI_TEXT.hardwareRefused : UI_TEXT.approvalHardwareNote,
  }
}
