// The approvals Muse is waiting on, docked just above the composer as in
// Claude Code's panel (PLAN.md D26): always in view, whatever the scroll. The
// oldest waits here, in the order Muse Code asked; a count says how many
// more do, each moving up as the one before is settled. Its row in the
// transcript keeps a compact record and, once decided, the decision.
//
// Focus moves to a card when it arrives, unless the user is typing (the
// panel's live region announces it then): onto the card itself, never onto
// a choice that a stray Enter would make.

import { useEffect, useRef } from 'react'
import {
  ATTENTION_DOCK_MAX_VIEWPORT_FRACTION,
  DOCK_TYPING_GRACE_MS,
  UI_TEXT,
} from '../../shared/constants'
import { plural } from '../../shared/l10n/text'
import type { PendingQuestion, PendingElicitation, WaitingApproval } from '../state/uiState'
import { ApprovalCard, type ApprovalCardProps } from './ApprovalCard'
import { QuestionCard, type QuestionCardProps, useAttentionSurface } from './QuestionCard'
import { ElicitationCard, type ElicitationCardProps } from './ElicitationCard'
import { OpenQuestionsChip } from './OpenQuestionsChip'

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

/**
 * Whether the user is typing where focus is: a field holding text, or one
 * that took a key a moment ago. A card arriving then leaves focus there.
 * An empty composer that merely kept focus after a send is not typing.
 */
function isTyping(element: Element | null, lastKeyAt: number): boolean {
  const isRecentKey = Date.now() - lastKeyAt < DOCK_TYPING_GRACE_MS
  const isTextField = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
  return isTextField
    ? element.value !== '' || isRecentKey
    : (element instanceof HTMLSelectElement ||
        (element instanceof HTMLElement && element.isContentEditable)) &&
        isRecentKey
}

export function AttentionDock({
  waiting,
  onDecide,
  isInert = false,
  questionGroup,
}: AttentionDockProps) {
  const surface = useAttentionSurface()
  const questions =
    questionGroup?.questions.filter((question) =>
      ['waiting', 'open'].includes(question.state ?? 'waiting'),
    ) ?? []
  const waitingQuestions = questions
    .filter((question) => question.state !== 'open')
    .toSorted((a, b) => (a.askedAt ?? 0) - (b.askedAt ?? 0))
  const openQuestions = questions.filter((question) => question.state === 'open')
  const forms = questionGroup?.elicitations ?? []
  const chosen = surface?.dockCard
  const selected =
    chosen !== undefined &&
    (chosen.kind === 'question'
      ? questions.some((question) => question.userInputId === chosen.id)
      : forms.some((form) => form.elicitationId === chosen.id))
      ? chosen
      : undefined
  const reminded = questions.find(
    (question) => question.userInputId === surface?.navigation?.userInputId,
  )
  const drafted = questions.find((question) => {
    const draft = surface?.drafts[question.userInputId]
    return (
      draft !== undefined &&
      (draft.explanation !== '' ||
        Object.values(draft.choices).some((entry) => entry.chosen.length > 0 || entry.other !== ''))
    )
  })
  const firstQuestion = reminded ?? waitingQuestions[0] ?? drafted
  const firstForm = forms[0]
  const defaultForm =
    firstForm === undefined ? undefined : { kind: 'elicitation', id: firstForm.elicitationId }
  const active =
    selected ??
    (firstQuestion === undefined
      ? defaultForm
      : { kind: 'question', id: firstQuestion.userInputId })
  const dock = useRef<HTMLElement>(null)
  const lastKeyAt = useRef(0)
  useEffect(() => {
    const onKey = () => {
      lastKeyAt.current = Date.now()
    }
    document.addEventListener('keydown', onKey, { capture: true })
    return () => {
      document.removeEventListener('keydown', onKey, { capture: true })
    }
  }, [])
  const first = waiting[0]
  const stageKey =
    first === undefined
      ? undefined
      : `${first.approval.approvalId}:${String(first.approval.requirementId.sourceIndex)}`
  const focusKey = stageKey ?? active?.id
  useEffect(() => {
    if (focusKey === undefined || isInert || isTyping(document.activeElement, lastKeyAt.current)) {
      return
    }
    dock.current
      ?.querySelector<HTMLElement>(
        stageKey === undefined
          ? '.question:not([hidden]), [data-elicitation-id]:not([hidden]) > form'
          : '[role="group"]',
      )
      ?.focus()
  }, [focusKey, stageKey, isInert])
  if (first === undefined && questions.length === 0 && forms.length === 0) return null
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
      {questionGroup === undefined ? null : (
        <div className="attention-questions">
          {first === undefined || openQuestions.length > 0 ? null : (
            <div className="attention-question-line">{UI_TEXT.questionOpen}</div>
          )}
          <div hidden={first !== undefined}>
            {waitingQuestions.map((question) => (
              <button
                key={question.userInputId}
                type="button"
                className="button-secondary attention-question-selector"
                onClick={() => {
                  surface?.selectDockCard({ kind: 'question', id: question.userInputId })
                }}
              >
                {UI_TEXT.questionOpen}: {question.questions[0]?.header}
              </button>
            ))}
            {forms.map((form) => (
              <button
                key={form.elicitationId}
                type="button"
                className="button-secondary attention-question-selector"
                onClick={() => {
                  surface?.selectDockCard({ kind: 'elicitation', id: form.elicitationId })
                }}
              >
                {form.server}
              </button>
            ))}
          </div>
          <div hidden={first !== undefined}>
            {questions.map((question) => (
              <QuestionCard
                key={`${surface?.sessionId ?? ''}:${question.userInputId}`}
                question={question}
                isDockCard
                isDockActive={active?.kind === 'question' && active.id === question.userInputId}
                onAnswer={questionGroup.onAnswer}
                onCancel={questionGroup.onCancel}
                onClarify={questionGroup.onClarify}
              />
            ))}
            {forms.map((form) => (
              <div
                key={`${surface?.sessionId ?? ''}:${form.elicitationId}`}
                data-elicitation-id={form.elicitationId}
                hidden={active?.kind !== 'elicitation' || active.id !== form.elicitationId}
              >
                <ElicitationCard
                  form={form}
                  onAccept={questionGroup.onAcceptElicitation}
                  onDecline={questionGroup.onDeclineElicitation}
                  onCancel={questionGroup.onCancelElicitation}
                />
              </div>
            ))}
          </div>
          {openQuestions.length === 0 ? null : (
            <OpenQuestionsChip
              count={openQuestions.length}
              onAnswer={() => {
                const question = openQuestions[0]
                if (question !== undefined)
                  surface?.selectDockCard({ kind: 'question', id: question.userInputId })
              }}
              onJump={questionGroup.onJump}
            />
          )}
        </div>
      )}
    </section>
  )
}
