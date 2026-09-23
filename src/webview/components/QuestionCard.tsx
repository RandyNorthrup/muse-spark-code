// The question card for `request_user_input`, laid out as Claude Code's
// (M16): one tab per question when there are several, the options stacked
// as radio buttons (single choice) or checkboxes (multiple choice), always
// an "Other" row with a free-text box, and Submit (disabled until every
// question has an answer) beside Cancel (which declines the prompt).

import { useState } from 'react'
import type { Question, QuestionAnswer } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import type { PendingQuestion } from '../state/uiState'

export interface QuestionCardProps {
  readonly question: PendingQuestion
  readonly onAnswer: (userInputId: string, answers: readonly QuestionAnswer[]) => void
  readonly onCancel: (userInputId: string) => void
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
  onChange,
}: {
  readonly type: 'radio' | 'checkbox'
  readonly name: string
  readonly label: string
  readonly detail: string | undefined
  readonly isChecked: boolean
  readonly onChange: () => void
}) {
  return (
    <label className="question-choice">
      <input type={type} name={name} checked={isChecked} onChange={onChange} />
      <span className="question-choice-label">{label}</span>
      {detail === undefined ? null : <span className="question-choice-detail">{detail}</span>}
    </label>
  )
}

export function QuestionCard({ question, onAnswer, onCancel }: QuestionCardProps) {
  const [draft, setDraft] = useState<Draft>({})
  const [activeIndex, setActiveIndex] = useState(0)
  const draftFor = (id: string) => draft[id] ?? EMPTY_DRAFT
  const update = (id: string, change: Partial<QuestionDraft>) => {
    setDraft({ ...draft, [id]: { ...draftFor(id), ...change } })
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
        <div className="question-header">{entry.header}</div>
        <div className="question-text">{entry.question}</div>
        {entry.options.length === 0 ? null : (
          <div className="question-options" role={isMultiple(entry) ? 'group' : 'radiogroup'}>
            {entry.options.map((option) => (
              <Choice
                key={option.label}
                type={type}
                name={entry.id}
                label={option.label}
                detail={option.description}
                isChecked={current.chosen.includes(option.label)}
                onChange={() => {
                  choose(entry, option.label)
                }}
              />
            ))}
            <Choice
              type={type}
              name={entry.id}
              label={UI_TEXT.questionOther}
              detail={undefined}
              isChecked={current.isOther}
              onChange={() => {
                chooseOther(entry)
              }}
            />
          </div>
        )}
        <input
          className="question-input"
          type="text"
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
    <div className="question" role="group" aria-label={question.questions[0]?.header ?? ''}>
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
                setActiveIndex(index)
              }}
            >
              {entry.header}
              {isComplete(entry, draftFor(entry.id)) ? ' ✓' : ''}
            </button>
          ))}
        </div>
      ) : null}
      {active === undefined ? null : renderQuestion(active)}
      <div className="question-actions">
        <button
          type="button"
          className="button-primary"
          disabled={!isReady}
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
          onClick={() => {
            onCancel(question.userInputId)
          }}
        >
          {UI_TEXT.questionCancel}
        </button>
      </div>
    </div>
  )
}
