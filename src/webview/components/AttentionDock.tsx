// The approvals Muse is waiting on, docked just above the composer as in
// Claude Code's panel (PLAN.md D26): always in view, whatever the scroll. The
// oldest waits here, in the order Muse Code asked; a count says how many
// more do, each moving up as the one before is settled. Its row in the
// transcript keeps a compact record and, once decided, the decision.
//
// Focus moves to a card when it arrives, unless the user is typing (the
// panel's live region announces it then): onto the card itself, never onto
// a choice that a stray Enter would make.

import { ATTENTION_DOCK_MAX_VIEWPORT_FRACTION, UI_TEXT } from '../../shared/constants'
import { plural } from '../../shared/l10n/text'
import type { PendingQuestion, PendingElicitation, WaitingApproval } from '../state/uiState'
import { ApprovalCard, type ApprovalCardProps } from './ApprovalCard'
import type { QuestionCardProps } from './QuestionCard'
import type { ElicitationCardProps } from './ElicitationCard'
import { useAttentionFocus } from './QuestionSurface'
import { DeferredQuestionDock } from './DeferredQuestionUi'

export interface AttentionDockProps {
  /** The approvals waiting, oldest first. */
  readonly waiting: readonly WaitingApproval[]
  readonly onDecide: ApprovalCardProps['onDecide']
  /** Behind a modal (M25). */
  readonly isInert?: boolean
  readonly questionGroup?: {
    readonly questions: readonly PendingQuestion[]
    readonly elicitations: readonly PendingElicitation[]
    readonly onAnswer: QuestionCardProps['onAnswer']
    readonly onCancel: QuestionCardProps['onCancel']
    readonly onClarify: QuestionCardProps['onClarify']
    readonly onAcceptElicitation: ElicitationCardProps['onAccept']
    readonly onDeclineElicitation: ElicitationCardProps['onDecline']
    readonly onCancelElicitation: ElicitationCardProps['onCancel']
    readonly onJump: (direction: 'next' | 'previous') => void
  }
}

export function AttentionDock({
  waiting,
  onDecide,
  isInert = false,
  questionGroup,
}: AttentionDockProps) {
  const first = waiting[0]
  const stageKey =
    first === undefined
      ? undefined
      : `${first.approval.approvalId}:${String(first.approval.requirementId.sourceIndex)}`
  const dock = useAttentionFocus<HTMLElement>(stageKey, '[role="group"]', isInert)
  const hasQuestions =
    questionGroup !== undefined &&
    (questionGroup.questions.some((question) =>
      ['waiting', 'open'].includes(question.state ?? 'waiting'),
    ) ||
      questionGroup.elicitations.length > 0)
  if (first === undefined && !hasQuestions) return null
  return (
    <section
      ref={dock}
      className="approval-dock attention-dock"
      style={{ maxHeight: `${String(ATTENTION_DOCK_MAX_VIEWPORT_FRACTION * 100)}vh` }}
      aria-label={first === undefined ? UI_TEXT.questionOpen : UI_TEXT.approvalDockLabel}
      inert={isInert}
    >
      {waiting.length > 1 ? (
        <p className="approval-dock-count">{plural(UI_TEXT.approvalDockCount, waiting.length)}</p>
      ) : null}
      {first === undefined ? null : (
        <ApprovalCard
          key={stageKey}
          approval={first.approval}
          toolName={first.toolName}
          onDecide={onDecide}
        />
      )}
      {hasQuestions ? (
        <DeferredQuestionDock
          questionGroup={questionGroup}
          hasApproval={first !== undefined}
          isInert={isInert}
        />
      ) : null}
    </section>
  )
}
