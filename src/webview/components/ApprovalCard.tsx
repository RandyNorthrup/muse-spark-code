// The permission card under a gated tool call: what Muse wants to do, one
// button per host-offered choice (Allow once / Always allow … / Reject), and a
// feedback box for choices that accept it. The row keys the card by stage,
// so the feedback box starts empty on every stage of a multi-command line (M25).

import { useState } from 'react'
import type { ApprovalStage, RequirementRef } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import { fill, templateParts } from '../../shared/l10n/text'
import { paidFeaturePrice } from '../../shared/paid'
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
 * The prompt of an image the card asks about (M34), and for an edit the
 * images it starts from (M44), shown so the user knows what is billed.
 */
function imageRequest(rawArgs: string): {
  readonly prompt: string | undefined
  readonly sources: readonly string[]
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArgs)
  } catch {
    return { prompt: undefined, sources: [] }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { prompt: undefined, sources: [] }
  }
  const prompt = 'prompt' in parsed && typeof parsed.prompt === 'string' ? parsed.prompt : undefined
  const images = 'images' in parsed && Array.isArray(parsed.images) ? parsed.images : []
  return {
    prompt,
    sources: images.filter((image): image is string => typeof image === 'string'),
  }
}

/** The card's sentence: a command or path, a tool, or an image to create or edit (M34, M44). */
function titleTemplate(
  approval: PendingApproval,
  stage: ApprovalStage | undefined,
  isEdit: boolean,
): string {
  if (approval.subject.paidFeature === 'imageGeneration') {
    return isEdit ? UI_TEXT.approvalEditImage : UI_TEXT.approvalCreateImage
  }
  return stage === undefined && approval.subject.kind === 'tool'
    ? UI_TEXT.approvalUseTool
    : UI_TEXT.approvalAction
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
  const { paidFeature } = approval.subject
  const image =
    paidFeature === undefined ? { prompt: undefined, sources: [] } : imageRequest(approval.rawArgs)
  // The language places the subject; it is shown as code wherever it lands.
  const title = titleTemplate(approval, stage, image.sources.length > 0)
  const { prompt } = image
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
      {image.sources.length === 0 ? null : (
        <div className="approval-sources">
          {templateParts(UI_TEXT.approvalImageSources).map((part, index) =>
            typeof part === 'string' ? (
              part
            ) : (
              <code key={String(index)}>{image.sources.join(', ')}</code>
            ),
          )}
        </div>
      )}
      {paidFeature !== undefined || approval.isProtectedWrite || approval.isJudgeEscalated ? (
        <div className="approval-flags">
          {paidFeature === undefined ? null : (
            <span className="approval-paid">
              {fill(UI_TEXT.approvalPaid, { price: paidFeaturePrice(paidFeature) })}
            </span>
          )}
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
