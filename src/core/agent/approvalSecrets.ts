// Approval cards holding a detected secret (M92e, PLAN.md D71): the panel
// never shows the raw value. The conversation controller scrubs every
// approval card through here before the panel, on both backends, reading
// the ONE shared detection table in redact.ts (no second pattern list).
// Only shell subjects are scrubbed: a command the agent proposes is the one
// the secret guard covers. Answering and running still use the approval id,
// so the redacted display changes nothing the decision runs.

import type { AgentEvent, ApprovalChoice, ApprovalSubject } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import { countSecretMatches, redactSecrets } from '../redact'

const SHELL_SUBJECT = 'shell'
const APPROVED_DECISION_PREFIX = 'approved'
const SESSION_SCOPE = 'session'

/** A shell approval's command text: its command and every stage's argv. */
export function shellSecretText(subject: ApprovalSubject): string | undefined {
  if (subject.kind !== SHELL_SUBJECT) {
    return undefined
  }
  const parts = [
    ...(subject.command === undefined ? [] : [subject.command]),
    ...(subject.stages ?? []).flatMap((stage) => stage.argv),
  ]
  return parts.length === 0 ? undefined : parts.join(' ')
}

/** Whether this shell subject's command holds a detected secret. */
export function hasApprovalSecret(subject: ApprovalSubject): boolean {
  const text = shellSecretText(subject)
  return text !== undefined && countSecretMatches(text, []) > 0
}

/** The subject with its command and stage lines redacted; other kinds pass through. */
export function scrubSecretSubject(subject: ApprovalSubject): ApprovalSubject {
  if (!hasApprovalSecret(subject)) {
    return subject
  }
  return {
    ...subject,
    ...(subject.command !== undefined && { command: redactSecrets(subject.command) }),
    ...(subject.stages !== undefined && {
      stages: subject.stages.map((stage) => ({
        ...stage,
        argv: stage.argv.map((arg) => redactSecrets(arg)),
      })),
    }),
  }
}

/**
 * The choices with no standing approve left (a session-scoped approve would
 * auto-allow the secret command later) and display text redacted. The abort
 * and allow-once choices never name the command.
 */
export function scrubSecretChoices(choices: readonly ApprovalChoice[]): ApprovalChoice[] {
  return choices
    .filter(
      (choice) =>
        !(choice.scope === SESSION_SCOPE && choice.decision.startsWith(APPROVED_DECISION_PREFIX)),
    )
    .map((choice) => ({
      ...choice,
      label: redactSecrets(choice.label),
      ...(choice.rulePreview !== undefined && { rulePreview: redactSecrets(choice.rulePreview) }),
    }))
}

type ApprovalCard = Extract<AgentEvent, { type: 'approvalRequested' | 'approvalUpdated' }>

/**
 * The card the panel may show: the value redacted, a secret note, and no
 * standing approve choice. Cards without a shell secret come back as they
 * were. The note replaces any quieter reason: the secret is what matters.
 */
export function scrubSecretApproval<T extends ApprovalCard>(event: T): T {
  if (!hasApprovalSecret(event.subject)) {
    return event
  }
  const shown = {
    ...event,
    subject: scrubSecretSubject(event.subject),
    availableChoices: scrubSecretChoices(event.availableChoices),
    note: UI_TEXT.approvalSecretNote,
  }
  return event.type === 'approvalRequested'
    ? { ...shown, rawArgs: redactSecrets(event.rawArgs) }
    : { ...shown }
}
