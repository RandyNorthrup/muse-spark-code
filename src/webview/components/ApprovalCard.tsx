// The permission card under a gated tool call: what Muse wants to do, one
// button per host-offered choice (Allow once / Always allow … / Reject), and a
// feedback box for choices that accept it. The row keys the card by stage,
// so the feedback box starts empty on every stage of a multi-command line (M25).
// A paid call never gets a card: the host's paid-use popup asks (M58).

import { useState } from 'react'
import type { ApprovalStage, RequirementRef } from '../../shared/agentEvents'
import { MODEL_API_SUBAGENT_TOOLS, UI_TEXT, WEB_FETCH_SUBJECT_KIND } from '../../shared/constants'
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

/**
 * A subagent spawn's objective (M18, M48), shown so the user knows what
 * approving the call will do.
 */
function spawnObjective(rawArgs: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArgs)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined
  }
  if ('objective' in parsed && typeof parsed.objective === 'string') {
    return parsed.objective
  }
  return 'message' in parsed && typeof parsed.message === 'string' ? parsed.message : undefined
}

/** The card's sentence: a command or path, a page to fetch (M69), or a tool. */
function titleTemplate(approval: PendingApproval, stage: ApprovalStage | undefined): string {
  if (stage !== undefined) {
    return UI_TEXT.approvalAction
  }
  switch (approval.subject.kind) {
    case 'tool': {
      return UI_TEXT.approvalUseTool
    }
    case WEB_FETCH_SUBJECT_KIND: {
      return UI_TEXT.approvalFetch
    }
    default: {
      return UI_TEXT.approvalAction
    }
  }
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
  const title = titleTemplate(approval, stage)
  const prompt =
    toolName === MODEL_API_SUBAGENT_TOOLS.spawn ? spawnObjective(approval.rawArgs) : undefined
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
      {prompt === undefined ? null : (
        <blockquote className="approval-prompt" dir="auto">
          {prompt}
        </blockquote>
      )}
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
