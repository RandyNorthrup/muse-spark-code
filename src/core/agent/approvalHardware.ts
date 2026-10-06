import type { AgentEvent, ApprovalSubject } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import { hardwareAction, hardwareArgvAction } from '../maker/guard/hardwareCommands'
import type { HardwareContext } from '../maker/guard/httpCommands'
import {
  isHardwareWorkspace,
  isReadOnlyHardwareCommand,
  isReadOnlyHardwareArgv,
  hardwareShellNote,
} from '../maker/guard/shellPolicy'
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
  if (actions.includes('refused')) return 'refused'
  if (isHardwareWorkspace(context)) {
    const dialects = ['bash', 'powershell', 'cmd'] as const
    const isReadOnly =
      (subject.command !== undefined || subject.stages?.length === 1) &&
      (subject.command === undefined ||
        dialects.every((dialect) =>
          isReadOnlyHardwareCommand(subject.command ?? '', dialect, context),
        )) &&
      (subject.stages === undefined ||
        (subject.stages.length === 1 &&
          dialects.every((dialect) =>
            isReadOnlyHardwareArgv(subject.stages?.[0]?.argv ?? [], dialect, context),
          )))
    if (!isReadOnly) return actions.find((action) => isDeviceAction(action)) ?? 'actuate'
  }
  return actions.find((action) => isDeviceAction(action))
}

/** Every physical action has only approve once and reject, never a prefix/session grant. */
export function scrubHardwareApproval<T extends ApprovalCard>(
  event: T,
  context: HardwareContext = {},
): T {
  const action =
    approvalHardwareAction(event.subject, context) ??
    (isPhysicalTool('toolName' in event ? event.toolName : '') ? 'actuate' : undefined)
  if (!isDeviceAction(action) && !(event.subject.kind === 'shell' && isHardwareWorkspace(context)))
    return event
  let note = UI_TEXT.approvalHardwareNote
  if (action === 'refused') note = UI_TEXT.hardwareRefused
  else if (event.subject.kind === 'shell' && isHardwareWorkspace(context))
    note = hardwareShellNote(
      event.subject.command === undefined
        ? hardwareArgvAction(event.subject.stages?.[0]?.argv ?? [], context)
        : hardwareAction(event.subject.command, 'bash', context),
    )
  return markHardwareApproval({
    ...event,
    availableChoices: event.availableChoices.filter(
      (choice) =>
        choice.scope === 'once' &&
        (choice.decision === 'abort' ||
          choice.decision === 'deny' ||
          (action !== 'refused' && choice.decision === 'approved')),
    ),
    note,
  })
}
