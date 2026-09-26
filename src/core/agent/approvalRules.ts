// The one approval a client answers without asking (PLAN.md D24): in "Edit
// automatically", a plain file write, allowed once. Never a protected
// write, an escalation, a staged command or anything in another mode. The
// panel's controller and the ACP agent (D62) both ask this module, so the
// rule exists once.

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

/** The allow-once choice "Edit automatically" takes; undefined for anything the user must see. */
export function editAutomaticallyChoice(
  event: Extract<AgentEvent, { type: 'approvalRequested' }>,
  mode: PermissionMode,
): ApprovalChoice | undefined {
  if (mode !== EDIT_AUTOMATICALLY_MODE || event.isProtectedWrite || event.isJudgeEscalated) {
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
