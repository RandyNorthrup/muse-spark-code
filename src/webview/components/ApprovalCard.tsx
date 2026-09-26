// The permission card under a gated tool call: what Muse wants to do, one
// button per host-offered choice (Allow once / Always allow … / Reject), and a
// feedback box for choices that accept it. The row keys the card by stage,
// so the feedback box starts empty on every stage of a multi-command line (M25).

import { useState } from 'react'
import type { ApprovalStage, RequirementRef } from '../../shared/agentEvents'
import { MODEL_API_SUBAGENT_TOOLS, UI_TEXT } from '../../shared/constants'
import { fill, templateParts } from '../../shared/l10n/text'
import { paidFeaturePrice, subagentTaskPrice } from '../../shared/paid'
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
 * An image prompt and its sources (M34, M44), or a subagent objective (M48),
 * shown so the user knows what approving the call will do.
 */
function requestDetails(rawArgs: string): {
  readonly prompt: string | undefined
  readonly sources: readonly string[]
  readonly objective: string | undefined
  readonly role: string | undefined
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArgs)
  } catch {
    return { prompt: undefined, sources: [], objective: undefined, role: undefined }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { prompt: undefined, sources: [], objective: undefined, role: undefined }
  }
  const prompt = 'prompt' in parsed && typeof parsed.prompt === 'string' ? parsed.prompt : undefined
  let objective =
    'objective' in parsed && typeof parsed.objective === 'string' ? parsed.objective : undefined
  if (objective === undefined && 'message' in parsed && typeof parsed.message === 'string') {
    objective = parsed.message
  }
  const role = 'role' in parsed && typeof parsed.role === 'string' ? parsed.role : undefined
  const images = 'images' in parsed && Array.isArray(parsed.images) ? parsed.images : []
  return {
    prompt,
    objective,
    role,
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
  if (approval.subject.paidFeature === 'subagents') {
    return UI_TEXT.approvalRunSubagent
  }
  return stage === undefined && approval.subject.kind === 'tool'
    ? UI_TEXT.approvalUseTool
    : UI_TEXT.approvalAction
}

function approvalPrice(approval: PendingApproval): string {
  const { paidFeature, modelId, requestLimit } = approval.subject
  if (paidFeature === 'subagents') {
    return modelId === undefined || requestLimit === undefined
      ? UI_TEXT.subagentTariffUnknown
      : subagentTaskPrice(modelId, requestLimit)
  }
  return paidFeature === undefined ? '' : paidFeaturePrice(paidFeature)
}

export function ApprovalCard({ approval, toolName, onDecide }: ApprovalCardProps) {
  const [feedback, setFeedback] = useState('')
  const hasFeedbackChoice = approval.availableChoices.some(
    (choice) => choice.acceptsFeedback === true,
  )
  const stage = currentStage(approval)
  // Decided and waiting for the host: no second decision on the same stage.
  const isLocked = approval.decidedSourceIndex === approval.requirementId.sourceIndex
  const { paidFeature } = approval.subject
  const details = requestDetails(approval.rawArgs)
  const subject =
    paidFeature === 'subagents'
      ? (details.role ?? subjectText(approval, toolName))
      : subjectText(approval, toolName)
  const image = paidFeature === undefined ? { prompt: undefined, sources: [] } : details
  // The language places the subject; it is shown as code wherever it lands.
  const title = titleTemplate(approval, stage, image.sources.length > 0)
  const prompt =
    paidFeature === 'subagents' || toolName === MODEL_API_SUBAGENT_TOOLS.spawn
      ? details.objective
      : image.prompt
  const price = approvalPrice(approval)
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
            <span className="approval-paid">{fill(UI_TEXT.approvalPaid, { price })}</span>
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
