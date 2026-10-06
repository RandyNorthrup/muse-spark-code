// The question card for `request_user_input`, laid out as Claude Code's
// (M16): one tab per question when there are several, the options stacked
// as radio buttons (single choice) or checkboxes (multiple choice), always
// an "Other" row with a free-text box, and Submit (disabled until every
// question has an answer) beside Cancel (which declines the prompt). Either
// locks the card until the host settles the question, as an approval card
// locks on a decision (M25): a second click cannot post a second answer.
// "Explain instead" (M46, MSP `userInput/clarify`) answers with a short text
// in place of the options; the model reads it and decides again.

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useCallback,
  useMemo,
  useId,
  useState,
} from 'react'
import type { Question, QuestionAnswer } from '../../shared/agentEvents'
import { CLARIFICATION_MAX_CHARS, MILLISECONDS_PER_SECOND, UI_TEXT } from '../../shared/constants'
import type { PendingQuestion, UiState } from '../state/uiState'
import type { QuestionState } from '../../shared/questions'
import { fill, formatNumber } from '../../shared/l10n/text'
import { ExpandChevron, CloseIcon } from './icons'
import { useRowMenu } from './GooeyMenu'

export interface QuestionCardProps {
  readonly question: PendingQuestion
  readonly isDockCard?: boolean
  readonly isDockActive?: boolean
  readonly onAnswer: (userInputId: string, answers: readonly QuestionAnswer[]) => void
  readonly onCancel: (userInputId: string) => void
  /** An explanation instead of the options (M46). */
  readonly onClarify: (userInputId: string, text: string) => void
}

/** The explanation box that replaces Submit while the user explains (M46). */
function ExplainForm({
  isLocked,
  isAutoFocus,
  text,
  onChange,
  onSend,
  onBack,
}: {
  readonly isLocked: boolean
  readonly isAutoFocus: boolean
  readonly text: string
  readonly onChange: (text: string) => void
  readonly onSend: (text: string) => void
  readonly onBack: () => void
}) {
  const inputId = useId()
  const trimmed = text.trim()
  return (
    <div className="question-explain">
      <label className="question-explain-label" htmlFor={inputId}>
        {UI_TEXT.questionExplainLabel}
      </label>
      <textarea
        id={inputId}
        className="question-input question-explain-input"
        dir="auto"
        rows={3}
        maxLength={CLARIFICATION_MAX_CHARS}
        disabled={isLocked}
        placeholder={UI_TEXT.questionExplainPlaceholder}
        value={text}
        autoFocus={isAutoFocus}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />
      <div className="question-actions">
        <button
          type="button"
          className="button-primary"
          disabled={trimmed === '' || isLocked}
          onClick={() => {
            onSend(trimmed)
          }}
        >
          {UI_TEXT.questionSendExplanation}
        </button>
        <button type="button" className="button-secondary" disabled={isLocked} onClick={onBack}>
          {UI_TEXT.questionBackToChoices}
        </button>
      </div>
    </div>
  )
}

interface QuestionDraft {
  readonly chosen: readonly string[]
  readonly isOther: boolean
  readonly other: string
}

const EMPTY_DRAFT: QuestionDraft = { chosen: [], isOther: false, other: '' }
type Draft = Readonly<Record<string, QuestionDraft>>

function isMultiple(question: Question): boolean {
  return question.selection.mode === 'multiple'
}

function hasOtherText(draft: QuestionDraft): boolean {
  return draft.isOther && draft.other.trim() !== ''
}

function answerFor(question: Question, draft: QuestionDraft): QuestionAnswer {
  const freeText = draft.other.trim()
  if (question.options.length === 0) {
    return { questionId: question.id, freeText }
  }
  if (isMultiple(question)) {
    return {
      questionId: question.id,
      selectedLabels: [...draft.chosen],
      ...(hasOtherText(draft) && { freeText }),
    }
  }
  return hasOtherText(draft)
    ? { questionId: question.id, freeText }
    : { questionId: question.id, selectedLabel: draft.chosen[0] ?? '' }
}

function isComplete(question: Question, draft: QuestionDraft): boolean {
  if (question.options.length === 0) {
    return draft.other.trim() !== ''
  }
  const picked = draft.chosen.length + (hasOtherText(draft) ? 1 : 0)
  const min = isMultiple(question) ? (question.selection.minSelections ?? 1) : 1
  return picked >= min
}

function Choice({
  type,
  name,
  label,
  detail,
  isChecked,
  isLocked,
  onChange,
}: {
  readonly type: 'radio' | 'checkbox'
  readonly name: string
  readonly label: string
  readonly detail: string | undefined
  readonly isChecked: boolean
  readonly isLocked: boolean
  readonly onChange: () => void
}) {
  return (
    <label className="question-choice">
      <input type={type} name={name} checked={isChecked} disabled={isLocked} onChange={onChange} />
      <span className="question-choice-label" dir="auto">
        {label}
      </span>
      {detail === undefined ? null : (
        <span className="question-choice-detail" dir="auto">
          {detail}
        </span>
      )}
    </label>
  )
}

interface CardDraft {
  readonly choices: Draft
  readonly activeIndex: number
  readonly isExplaining: boolean
  readonly explanation: string
}
const EMPTY_CARD_DRAFT: CardDraft = {
  choices: {},
  activeIndex: 0,
  isExplaining: false,
  explanation: '',
}
interface DockCard {
  readonly kind: 'question' | 'elicitation'
  readonly id: string
}
interface AttentionSurface {
  readonly sessionId: string | undefined
  readonly drafts: Readonly<Record<string, CardDraft>>
  readonly update: (id: string, change: Partial<CardDraft>) => void
  readonly navigation: UiState['questionNavigation']
  readonly dockCard: DockCard | undefined
  readonly dockRequests: number
  readonly selectDockCard: (card: DockCard | undefined) => void
  readonly onDismiss: (id: string) => void
}
const AttentionContext = createContext<AttentionSurface | undefined>(undefined)
export function useAttentionSurface() {
  return useContext(AttentionContext)
}

/** One in-memory draft shared by row and dock; a session boundary discards it. */
export function QuestionSurface({
  children,
  navigation,
  sessionId,
  onDismiss,
}: {
  readonly children: ReactNode
  readonly navigation: UiState['questionNavigation']
  readonly sessionId: string | undefined
  readonly onDismiss: (id: string) => void
}) {
  const [draftSession, setDraftSession] = useState(sessionId)
  const [drafts, setDrafts] = useState<Readonly<Record<string, CardDraft>>>({})
  const [dockCard, setDockCard] = useState<DockCard>()
  const [dockRequests, setDockRequests] = useState(0)
  const selectDockCard = useCallback((card: DockCard | undefined) => {
    setDockCard(card)
    if (card !== undefined) setDockRequests((previous) => previous + 1)
  }, [])
  const update = useCallback((id: string, change: Partial<CardDraft>) => {
    setDrafts((previous) => ({
      ...previous,
      [id]: { ...(previous[id] ?? EMPTY_CARD_DRAFT), ...change },
    }))
  }, [])
  const value = useMemo(
    () => ({
      sessionId,
      drafts,
      update,
      navigation,
      dockCard,
      dockRequests,
      selectDockCard,
      onDismiss,
    }),
    [sessionId, drafts, update, navigation, dockCard, dockRequests, selectDockCard, onDismiss],
  )
  if (draftSession !== sessionId) {
    setDraftSession(sessionId)
    setDrafts({})
    setDockCard(undefined)
    setDockRequests(0)
  }
  return <AttentionContext value={value}>{children}</AttentionContext>
}

function questionStateLabel(state: QuestionState): string {
  switch (state) {
    case 'waiting':
    case 'open': {
      return UI_TEXT.questionOpen
    }
    case 'answered': {
      return UI_TEXT.questionAnswered
    }
    case 'answeredLater': {
      return UI_TEXT.questionAnsweredLater
    }
    case 'answeredOnReask': {
      return UI_TEXT.questionAnsweredOnReask
    }
    case 'clarified': {
      return UI_TEXT.questionClarified
    }
    case 'cancelled': {
      return UI_TEXT.questionDeclined
    }
    case 'dismissed': {
      return UI_TEXT.questionDismissed
    }
    case 'expired': {
      return UI_TEXT.questionExpired
    }
  }
}

/** The question codicon's circle/question mark, inline to keep the existing CSP. */
function QuestionIcon({ state }: { readonly state: QuestionState }) {
  if (state === 'waiting' || state === 'open')
    return (
      <svg
        className="icon codicon-question"
        viewBox="0 0 16 16"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
      >
        <circle cx="8" cy="8" r="6.5" />
        <path d="M6 5.5a2 2 0 0 1 4 0c0 1.5-2 1.5-2 3M8 11v.5" />
      </svg>
    )
  const glyphs = {
    answered: '✓',
    answeredLater: '↩',
    answeredOnReask: '↻',
    clarified: '…',
    cancelled: '×',
    dismissed: '−',
    expired: '⌛',
  }
  return (
    <span className="question-state-icon" aria-hidden="true">
      {glyphs[state]}
    </span>
  )
}

function Countdown({ deadlineAt }: { readonly deadlineAt: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
    }, MILLISECONDS_PER_SECOND)
    return () => {
      clearInterval(timer)
    }
  }, [])
  return (
    <p className="question-countdown">
      {fill(UI_TEXT.questionCountdown, {
        seconds: formatNumber(Math.max(0, Math.ceil((deadlineAt - now) / MILLISECONDS_PER_SECOND))),
      })}
    </p>
  )
}

export function QuestionCard({
  question,
  onAnswer,
  onCancel,
  onClarify,
  isDockCard = false,
  isDockActive = true,
}: QuestionCardProps) {
  const surface = useAttentionSurface()
  const [localDraft, setLocalDraft] = useState<CardDraft>(EMPTY_CARD_DRAFT)
  const cardDraft = surface?.drafts[question.userInputId] ?? localDraft
  const changeDraft = (change: Partial<CardDraft>) => {
    if (surface === undefined) setLocalDraft((previous) => ({ ...previous, ...change }))
    else surface.update(question.userInputId, change)
  }
  const draft = cardDraft.choices
  const state = question.state ?? 'waiting'
  const isSettled = state !== 'waiting' && state !== 'open'
  const [isFocused, setIsFocused] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const requestKey = `${String(surface?.navigation?.sequence ?? 0)}:${String(isDockCard ? (surface?.dockRequests ?? 0) : 0)}`
  const [foldedRequest, setFoldedRequest] = useState<string>()
  const isManuallyFolded = foldedRequest === requestKey
  const hasDraft =
    cardDraft.explanation !== '' ||
    Object.values(draft).some((entry) => entry.chosen.length > 0 || entry.other !== '')
  const isNavigationTarget =
    surface?.navigation?.isReminder !== true &&
    surface?.navigation?.userInputId === question.userInputId
  const isFull =
    !isSettled &&
    (state === 'waiting' ||
      (!isManuallyFolded &&
        (isFocused ||
          hasDraft ||
          isExpanded ||
          isNavigationTarget ||
          (isDockCard && isDockActive))))
  const menu = useRowMenu(
    state !== 'open' || surface === undefined || !isDockCard
      ? []
      : [
          {
            id: 'dismiss',
            label: UI_TEXT.questionDismiss,
            icon: <CloseIcon />,
            disabled: question.isSubmitted === true,
            onSelect: () => {
              menu.close()
              surface.onDismiss(question.userInputId)
            },
          },
        ],
    UI_TEXT.rowMoreActions,
  )
  const isLocked = question.isSubmitted === true
  const { activeIndex, isExplaining } = cardDraft
  const cardId = useId()
  const draftFor = (id: string) => draft[id] ?? EMPTY_DRAFT
  const update = (id: string, change: Partial<QuestionDraft>) => {
    changeDraft({ choices: { ...draft, [id]: { ...draftFor(id), ...change } } })
  }
  const choose = (entry: Question, label: string) => {
    const current = draftFor(entry.id)
    if (!isMultiple(entry)) {
      update(entry.id, { chosen: [label], isOther: false })
      return
    }
    const next = current.chosen.includes(label)
      ? current.chosen.filter((value) => value !== label)
      : [...current.chosen, label]
    const max = entry.selection.maxSelections
    if (max !== undefined && next.length + (current.isOther ? 1 : 0) > max) {
      return
    }
    update(entry.id, { chosen: next })
  }
  const chooseOther = (entry: Question) => {
    const current = draftFor(entry.id)
    update(entry.id, {
      // A radio "Other" stays chosen once picked; a checkbox one toggles.
      isOther: !isMultiple(entry) || !current.isOther,
      ...(!isMultiple(entry) && { chosen: [] }),
    })
  }
  const typeOther = (entry: Question, text: string) => {
    const current = draftFor(entry.id)
    update(entry.id, {
      other: text,
      isOther: true,
      ...(!isMultiple(entry) && { chosen: [] }),
      ...(isMultiple(entry) && !current.isOther && { chosen: current.chosen }),
    })
  }
  const isReady = question.questions.every((entry) => isComplete(entry, draftFor(entry.id)))
  const active = question.questions[activeIndex] ?? question.questions[0]
  const renderQuestion = (entry: Question) => {
    const current = draftFor(entry.id)
    const type = isMultiple(entry) ? 'checkbox' : 'radio'
    return (
      <div key={entry.id} className="question-block">
        <div className="question-header" dir="auto">
          {entry.header}
        </div>
        <div className="question-text" dir="auto">
          {entry.question}
        </div>
        {entry.options.length === 0 ? null : (
          <div className="question-options" role={isMultiple(entry) ? 'group' : 'radiogroup'}>
            {entry.options.map((option) => (
              <Choice
                key={option.label}
                type={type}
                name={`${cardId}-${entry.id}`}
                label={option.label}
                detail={option.description}
                isChecked={current.chosen.includes(option.label)}
                isLocked={isLocked}
                onChange={() => {
                  choose(entry, option.label)
                }}
              />
            ))}
            <Choice
              type={type}
              name={`${cardId}-${entry.id}`}
              label={UI_TEXT.questionOther}
              detail={undefined}
              isChecked={current.isOther}
              isLocked={isLocked}
              onChange={() => {
                chooseOther(entry)
              }}
            />
          </div>
        )}
        <input
          className="question-input"
          type="text"
          dir="auto"
          disabled={isLocked}
          aria-label={`${UI_TEXT.questionOther}: ${entry.header}`}
          placeholder={
            entry.options.length === 0
              ? UI_TEXT.questionFreeTextPlaceholder
              : UI_TEXT.questionOtherPlaceholder
          }
          value={current.other}
          onChange={(event) => {
            typeOther(entry, event.target.value)
          }}
        />
      </div>
    )
  }
  return (
    <div
      className={`question question-${state}${isFull ? '' : ' question-folded'}`}
      data-question-id={question.userInputId}
      data-question-slot={isDockCard ? 'dock' : 'row'}
      hidden={isDockCard && !isDockActive}
      tabIndex={-1}
      onFocus={() => {
        setIsFocused(true)
        if (isDockCard) surface?.selectDockCard({ kind: 'question', id: question.userInputId })
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) {
          return
        }

        setIsFocused(false)
        if (state === 'open') setFoldedRequest(requestKey)
        if (isDockCard && state === 'open') surface?.selectDockCard(undefined)
      }}
      {...menu.rowProps}
      role="group"
      aria-label={question.questions[0]?.header ?? ''}
      aria-busy={isLocked}
    >
      <div className="question-summary">
        <span className="question-state-label">
          <QuestionIcon state={state} />
          {questionStateLabel(state)}
        </span>
        <span className="question-summary-header" dir="auto" title={question.questions[0]?.header}>
          {question.questions[0]?.header}
        </span>
        {state === 'open' ? (
          <>
            {isFull ? null : (
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  setIsExpanded(true)
                  setFoldedRequest(undefined)
                }}
              >
                {UI_TEXT.questionAnswer}
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label={isFull ? UI_TEXT.questionCollapse : UI_TEXT.questionExpand}
              aria-expanded={isFull}
              onClick={() => {
                setIsExpanded(!isFull)
                setFoldedRequest(isFull ? requestKey : undefined)
              }}
            >
              <ExpandChevron isOpen={isFull} />
            </button>
          </>
        ) : null}
      </div>
      <div hidden={!isFull} inert={menu.isOpen}>
        {state === 'waiting' && question.deadlineAt !== undefined ? (
          <Countdown deadlineAt={question.deadlineAt} />
        ) : null}
        {question.questions.length > 1 ? (
          <div className="question-tabs" role="tablist">
            {question.questions.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                className="question-tab"
                aria-selected={index === activeIndex}
                onClick={() => {
                  changeDraft({ activeIndex: index })
                }}
              >
                {entry.header}
                {isComplete(entry, draftFor(entry.id)) ? ' ✓' : ''}
              </button>
            ))}
          </div>
        ) : null}
        {active === undefined ? null : renderQuestion(active)}
        {isExplaining ? (
          <ExplainForm
            isLocked={isLocked}
            isAutoFocus={isFocused}
            text={cardDraft.explanation}
            onChange={(explanation) => {
              changeDraft({ explanation })
            }}
            onSend={(text) => {
              onClarify(question.userInputId, text)
            }}
            onBack={() => {
              changeDraft({ isExplaining: false })
            }}
          />
        ) : (
          <div className="question-actions">
            <button
              type="button"
              className="button-primary"
              disabled={!isReady || isLocked}
              onClick={() => {
                onAnswer(
                  question.userInputId,
                  question.questions.map((entry) => answerFor(entry, draftFor(entry.id))),
                )
              }}
            >
              {UI_TEXT.questionSubmit}
            </button>
            <button
              type="button"
              className="button-secondary"
              title={UI_TEXT.questionExplainTitle}
              disabled={isLocked}
              onClick={() => {
                changeDraft({ isExplaining: true })
              }}
            >
              {UI_TEXT.questionExplain}
            </button>
            {state === 'open' ? null : (
              <button
                type="button"
                className="button-secondary"
                disabled={isLocked}
                onClick={() => {
                  onCancel(question.userInputId)
                }}
              >
                {UI_TEXT.questionCancel}
              </button>
            )}
          </div>
        )}
      </div>
      {menu.menu}
    </div>
  )
}
