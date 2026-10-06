import { useEffect, useRef, useLayoutEffect, type RefObject } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { QuestionCard } from './QuestionCard'
import { ElicitationCard } from './ElicitationCard'
import { OpenQuestionsChip } from './OpenQuestionsChip'
import { useAttentionSurface, isTyping } from './QuestionSurface'
import type { AttentionDockProps } from './AttentionDock'
export function QuestionDock({
  questionGroup,
  hasApproval,
  isInert,
  lastKeyAt,
}: {
  readonly questionGroup: NonNullable<AttentionDockProps['questionGroup']>
  readonly hasApproval: boolean
  readonly isInert: boolean
  readonly lastKeyAt: RefObject<number>
}) {
  const surface = useAttentionSurface()
  useLayoutEffect(() => {
    const target = surface?.navigation
    if (target === undefined || target.isReminder === true) return
    const candidates = [...document.querySelectorAll<HTMLElement>('[data-question-id]')].filter(
      (element) => element.dataset['questionId'] === target.userInputId,
    )
    const card =
      candidates.find((element) => element.dataset['questionSlot'] === 'row') ??
      candidates.find((element) => !element.hidden)
    if (card?.closest('[inert]') !== null) return
    card.scrollIntoView({ block: 'nearest' })
    card.focus()
  }, [surface?.navigation])
  const questions = questionGroup.questions.filter((question) =>
    ['waiting', 'open'].includes(question.state ?? 'waiting'),
  )
  const waitingQuestions = questions
    .filter((question) => question.state !== 'open')
    .toSorted((a, b) => (a.askedAt ?? 0) - (b.askedAt ?? 0))
  const openQuestions = questions.filter((question) => question.state === 'open')
  const forms = questionGroup.elicitations
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
  const dock = useRef<HTMLDivElement>(null)
  const focusKey = active?.id
  useEffect(() => {
    if (hasApproval || isInert || isTyping(document.activeElement, lastKeyAt.current)) return
    dock.current
      ?.querySelector<HTMLElement>(
        ':scope .question:not([hidden]), :scope [data-elicitation-id]:not([hidden]) > form',
      )
      ?.focus()
  }, [focusKey, hasApproval, isInert, lastKeyAt])
  return (
    <div ref={dock}>
      {' '}
      <div className="attention-questions">
        {!hasApproval || openQuestions.length > 0 ? null : (
          <div className="attention-question-line">{UI_TEXT.questionOpen}</div>
        )}
        <div hidden={hasApproval}>
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
        <div hidden={hasApproval}>
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
    </div>
  )
}

import type { OpenQuestionAnswer } from '../../shared/questions'
import type { WebviewToHostMessage } from '../../shared/protocol'
import type { UiStore } from '../state/store'
import { questionsInOrder } from '../state/uiState'

/** Read fresh state and lock before dispatch, shared by the dock and transcript. */
export function questionAction(
  store: UiStore,
  postMessage: (message: WebviewToHostMessage) => void,
  userInputId: string,
  reply: OpenQuestionAnswer | 'dismiss' | undefined,
): void {
  if (reply === 'dismiss') {
    dismissQuestion(store, postMessage, userInputId)
    return
  }
  const current = store.getState()
  const question = questionsInOrder(current).find((card) => card.userInputId === userInputId)
  if (
    question === undefined ||
    question.isSubmitted === true ||
    current.submittedQuestions.includes(userInputId) ||
    (reply === undefined && (question.state ?? 'waiting') !== 'waiting')
  )
    return
  store.dispatch({ type: 'questionSubmitted', userInputId })
  if (reply !== undefined && question.state === 'open' && current.sessionId !== undefined) {
    postMessage({
      type: 'answerOpenQuestion',
      sessionId: current.sessionId,
      userInputId,
      reply,
    })
  } else if ((question.state ?? 'waiting') === 'waiting') {
    if (reply === undefined) postMessage({ type: 'cancelQuestion', userInputId })
    else if ('explanation' in reply)
      postMessage({ type: 'clarifyQuestion', userInputId, text: reply.explanation })
    else postMessage({ type: 'answerQuestion', userInputId, answers: reply.answers })
  }
}

function dismissQuestion(
  store: UiStore,
  postMessage: (message: WebviewToHostMessage) => void,
  userInputId: string,
): void {
  const current = store.getState()
  if (
    current.sessionId === undefined ||
    current.submittedQuestions.includes(userInputId) ||
    questionsInOrder(current).every(
      (question) => !(question.userInputId === userInputId && question.state === 'open'),
    )
  )
    return
  store.dispatch({ type: 'questionSubmitted', userInputId })
  postMessage({ type: 'dismissOpenQuestion', sessionId: current.sessionId, userInputId })
}
