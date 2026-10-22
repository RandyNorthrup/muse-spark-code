import type { AgentEvent, ApprovalSubject } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import {
  hardwareAction,
  hardwareArgvAction,
  hardwareTargets,
  isHardwareStop,
} from '../maker/guard/hardwareCommands'
import type { HardwareContext } from '../maker/guard/httpCommands'
import { isHardwareWorkspace, hardwareShellNote } from '../maker/guard/shellPolicy'
import { isDeviceAction, isPhysicalTool, type ActionClass } from '../maker/guard/actionClass'

type ApprovalCard = Extract<AgentEvent, { type: 'approvalRequested' | 'approvalUpdated' }>
// Private host metadata, never a wire field or a translated-title decision.
// Enumerable symbols survive host-side card copies; JSON/model input cannot mint one.
const HARDWARE_APPROVAL = Symbol('hardwareApproval')

export function markHardwareApproval<T extends object>(event: T): T {
  Object.defineProperty(event, HARDWARE_APPROVAL, { value: true, enumerable: true })
  return event
}

export function hasHardwareApproval(event: object): boolean {
  return Object.hasOwn(event, HARDWARE_APPROVAL)
}

/** Shell argv is checked independently per stage, never flattened across command boundaries. */
export function approvalHardwareAction(
  subject: ApprovalSubject,
  context: HardwareContext = {},
): ActionClass | undefined {
  if (
    subject.kind === 'shell' &&
    subject.command !== undefined &&
    isHardwareStop(subject.command, 'bash', context)
  )
    return undefined
  if (isPhysicalTool(subject.toolName ?? '')) return 'actuate'
  if (subject.kind !== 'shell') return undefined
  const actions = [
    ...(subject.command === undefined
      ? []
      : [
          hardwareAction(subject.command, 'bash', context),
          hardwareAction(subject.command, 'powershell', context),
          hardwareAction(subject.command, 'cmd', context),
        ]),
    ...(subject.stages ?? []).map((stage) => hardwareArgvAction(stage.argv, context)),
  ]
  if (isHardwareWorkspace(context)) {
    return actions.find((action) => action !== 'refused' && isDeviceAction(action)) ?? 'actuate'
  }
  return actions.includes('refused') ? 'refused' : actions.find((action) => isDeviceAction(action))
}

/** Every physical action has only approve once and reject, never a prefix/session grant. */
export function scrubHardwareApproval<T extends ApprovalCard>(
  event: T,
  context: HardwareContext = {},
): T {
  if (
    event.subject.kind === 'shell' &&
    event.subject.command !== undefined &&
    isHardwareStop(event.subject.command, 'bash', context)
  )
    return event
  const action =
    approvalHardwareAction(event.subject, context) ??
    (isPhysicalTool('toolName' in event ? event.toolName : '') ? 'actuate' : undefined)
  if (!isDeviceAction(action) && !(event.subject.kind === 'shell' && isHardwareWorkspace(context)))
    return event
  let note = UI_TEXT.approvalHardwareNote
  const hasNoBindingAdapter = event.subject.kind !== 'shell'
  if (action === 'refused') note = UI_TEXT.hardwareRefused
  else if (hasNoBindingAdapter) note = UI_TEXT.hardwareBindingUnavailable
  else if (event.subject.kind === 'shell' && isHardwareWorkspace(context))
    note = hardwareShellNote(
      event.subject.command === undefined
        ? hardwareArgvAction(event.subject.stages?.[0]?.argv ?? [], context)
        : hardwareAction(event.subject.command, 'bash', context),
      hardwareTargets(
        event.subject.command ?? event.subject.target ?? event.subject.kind,
        'bash',
        context,
        event.subject.stages?.map((stage) => stage.argv),
      ),
    )
  return markHardwareApproval({
    ...event,
    availableChoices: event.availableChoices.filter(
      (choice) =>
        choice.scope === 'once' &&
        (choice.decision === 'abort' ||
          choice.decision === 'deny' ||
          (action !== 'refused' && !hasNoBindingAdapter && choice.decision === 'approved')),
    ),
    note,
  })
}
