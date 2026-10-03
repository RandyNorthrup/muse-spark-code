// The one approval a client answers without asking (PLAN.md D24): in "Edit
// automatically", a plain file write, allowed once. Never a protected
// write, an escalation, a staged command, a request replayed from history
// (M46) or anything in another mode. The panel's controller and the ACP
// agent (D62) both ask this module, so the rule exists once; the panel
// adds its own condition (one panel holding the session).
//
// A custom agent's child (M76) carries its own `permission-mode` on its
// approval requests. The mode its approvals are answered under is one pure
// function of its parent's mode and its own (`childPermissionMode`), so
// both clients apply the same table.

import type { AgentEvent, ApprovalChoice } from '../../shared/agentEvents'
import type { PermissionMode } from '../../shared/constants'

const EDIT_AUTOMATICALLY_MODE: PermissionMode = 'acceptEdits'
// Approval subjects that are a plain file write: the Model API's own, and
// Muse Code's `fileAccess` with write access (MSP `ApprovalSubject`).
const FILE_WRITE_SUBJECT = 'fileWrite'
const FILE_ACCESS_SUBJECT = 'fileAccess'
const WRITE_ACCESS = 'write'
const APPROVED_DECISION = 'approved'
const ONCE_SCOPE = 'once'

// The modes from least to most automatic. Plan refuses; Manual asks for
// every write; Edit automatically answers ordinary writes itself; Auto and
// Bypass already run ordinary writes without a card (permissions.ts). The
// host's own narrowing of the approval mode (narrowApprovalMode) follows
// the same order, which the table test holds the two to.
const AUTOMATION_ORDER: readonly PermissionMode[] = [
  'plan',
  'manual',
  'acceptEdits',
  'auto',
  'bypassPermissions',
]

/**
 * The mode a child's approvals are answered under (M76 review, RV70x): the
 * less automatic of its parent's mode and its own `permission-mode`, the
 * parent's when the agent names none. So a Manual parent caps every child,
 * a Manual child asks under any parent, and an Edit automatically child
 * keeps its automation under an Auto or Bypass parent, which permits it.
 */
export function childPermissionMode(
  parent: PermissionMode,
  child: PermissionMode | undefined,
): PermissionMode {
  if (child === undefined) {
    return parent
  }
  return AUTOMATION_ORDER.indexOf(child) < AUTOMATION_ORDER.indexOf(parent) ? child : parent
}

/**
 * The allow-once choice "Edit automatically" takes for a request answered
 * under `mode` (the client's own, for the parent conversation); undefined
 * for anything the user must see.
 */
export function editAutomaticallyChoice(
  event: Extract<AgentEvent, { type: 'approvalRequested' }>,
  mode: PermissionMode,
): ApprovalChoice | undefined {
  if (
    childPermissionMode(mode, event.permissionMode) !== EDIT_AUTOMATICALLY_MODE ||
    event.isReplayed === true ||
    event.isProtectedWrite ||
    event.isJudgeEscalated
  ) {
    return undefined
  }
  const { subject } = event
  const isFileWrite =
    subject.kind === FILE_WRITE_SUBJECT ||
    (subject.kind === FILE_ACCESS_SUBJECT && subject.access === WRITE_ACCESS)
  return isFileWrite && subject.stages === undefined
    ? event.availableChoices.find(
        (choice) => choice.decision === APPROVED_DECISION && choice.scope === ONCE_SCOPE,
      )
    : undefined
}
