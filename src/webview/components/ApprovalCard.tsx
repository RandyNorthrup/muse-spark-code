// The permission card under a gated tool call: what Muse wants to do, one
// button per host-offered choice (Allow once / Always allow … / Reject), and a
// feedback box for choices that accept it. The row keys the card by stage,
// so the feedback box starts empty on every stage of a multi-command line (M25).

import { useState } from 'react'
import type { ApprovalStage, RequirementRef } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import { fill, templateParts } from '../../shared/l10n/text'
import type { PendingApproval } from '../state/uiState'

export interface ApprovalDecisionInput {
  readonly approvalId: string
  readonly choiceId: string
  readonly requirementId: RequirementRef
  readonly feedback: string | undefined
}

export interface ApprovalCardProps {
  readonly approval: PendingApproval
  readonly toolName: string
  readonly onDecide: (decision: ApprovalDecisionInput) => void
}

/** The stage being decided now, when the subject is a multi-command shell line. */
function currentStage(approval: PendingApproval): ApprovalStage | undefined {
  return approval.subject.stages?.find(
    (stage) => stage.requirementId.sourceIndex === approval.requirementId.sourceIndex,
  )
}

function subjectText(approval: PendingApproval, toolName: string): string {
  const stage = currentStage(approval)
  if (stage !== undefined) {
    return stage.argv.join(' ')
  }
  const { subject } = approval
  return subject.command ?? subject.path ?? subject.host ?? subject.target ?? toolName
}

export function ApprovalCard({ approval, toolName, onDecide }: ApprovalCardProps) {
  const [feedback, setFeedback] = useState('')
  const hasFeedbackChoice = approval.availableChoices.some(
    (choice) => choice.acceptsFeedback === true,
  )
  const stage = currentStage(approval)
  // Decided and waiting for the host: no second decision on the same stage.
  const isLocked = approval.decidedSourceIndex === approval.requirementId.sourceIndex
  const subject = subjectText(approval, toolName)
  // The language places the subject; it is shown as code wherever it lands.
  const title =
    stage === undefined && approval.subject.kind === 'tool'
      ? UI_TEXT.approvalUseTool
      : UI_TEXT.approvalAction
  return (
    <div
      className="approval"
      role="group"
      aria-label={fill(title, { action: subject })}
      aria-busy={isLocked}
    >
      <div className="approval-title">
        {templateParts(title).map((part, index) =>
          typeof part === 'string' ? part : <code key={String(index)}>{subject}</code>,
        )}
        {stage !== undefined && stage.totalStages > 1 ? (
          <span className="approval-stage">
            {' '}
            ({fill(UI_TEXT.approvalStage, { position: stage.position, total: stage.totalStages })})
          </span>
        ) : null}
      </div>
      {approval.isProtectedWrite || approval.isJudgeEscalated ? (
        <div className="approval-flags">
          {approval.isProtectedWrite ? <span>{UI_TEXT.approvalProtectedWrite}</span> : null}
          {approval.isJudgeEscalated ? <span>{UI_TEXT.approvalJudgeEscalated}</span> : null}
        </div>
      ) : null}
      {hasFeedbackChoice ? (
        <textarea
          className="approval-feedback"
          dir="auto"
          rows={2}
          placeholder={UI_TEXT.approvalFeedbackPlaceholder}
          value={feedback}
          disabled={isLocked}
          onChange={(event) => {
            setFeedback(event.target.value)
          }}
        />
      ) : null}
      <div className="approval-choices">
        {approval.availableChoices.map((choice) => (
          <button
            key={choice.choiceId}
            type="button"
            className={
              choice.decision.startsWith('approved') ? 'button-primary' : 'button-secondary'
            }
            title={choice.rulePreview}
            disabled={isLocked}
            onClick={() => {
              onDecide({
                approvalId: approval.approvalId,
                choiceId: choice.choiceId,
                requirementId: approval.requirementId,
                feedback:
                  choice.acceptsFeedback === true && feedback.trim() !== ''
                    ? feedback.trim()
                    : undefined,
              })
            }}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  )
}
