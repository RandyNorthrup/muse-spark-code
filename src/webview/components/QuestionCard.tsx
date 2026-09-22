// The question card for `request_user_input`: every question with its
// options (single or multiple choice) or a free-text box, then Submit.

import { useState } from 'react'
import type { Question, QuestionAnswer } from '../../shared/agentEvents'
import { UI_TEXT } from '../../shared/constants'
import type { PendingQuestion } from '../state/uiState'

export interface QuestionCardProps {
  readonly question: PendingQuestion
  readonly onAnswer: (userInputId: string, answers: readonly QuestionAnswer[]) => void
}

type Draft = Readonly<Record<string, readonly string[]>>

function isMultiple(question: Question): boolean {
  return question.selection.mode === 'multiple'
}

function answerFor(question: Question, chosen: readonly string[]): QuestionAnswer {
  if (question.options.length === 0) {
    return { questionId: question.id, freeText: chosen[0] ?? '' }
  }
  return isMultiple(question)
    ? { questionId: question.id, selectedLabels: [...chosen] }
    : { questionId: question.id, selectedLabel: chosen[0] ?? '' }
}

function isComplete(question: Question, chosen: readonly string[]): boolean {
  if (question.options.length === 0) {
    return (chosen[0] ?? '').trim() !== ''
  }
  const min = isMultiple(question) ? (question.selection.minSelections ?? 1) : 1
  return chosen.length >= min
}

export function QuestionCard({ question, onAnswer }: QuestionCardProps) {
  const [draft, setDraft] = useState<Draft>({})
  const chosenFor = (id: string) => draft[id] ?? []
  const choose = (entry: Question, label: string) => {
    const current = chosenFor(entry.id)
    let next: readonly string[]
    if (isMultiple(entry)) {
      next = current.includes(label)
        ? current.filter((value) => value !== label)
        : [...current, label]
      const max = entry.selection.maxSelections
      if (max !== undefined && next.length > max) {
        return
      }
    } else {
      next = [label]
    }
    setDraft({ ...draft, [entry.id]: next })
  }
  const isReady = question.questions.every((entry) => isComplete(entry, chosenFor(entry.id)))
  return (
    <div className="question" role="group" aria-label={question.questions[0]?.header ?? ''}>
      {question.questions.map((entry) => (
        <div key={entry.id} className="question-block">
          <div className="question-header">{entry.header}</div>
          <div className="question-text">{entry.question}</div>
          {entry.options.length === 0 ? (
            <input
              className="question-input"
              type="text"
              placeholder={UI_TEXT.questionFreeTextPlaceholder}
              value={chosenFor(entry.id)[0] ?? ''}
              onChange={(event) => {
                setDraft({ ...draft, [entry.id]: [event.target.value] })
              }}
            />
          ) : (
            <div className="question-options" role={isMultiple(entry) ? 'group' : 'radiogroup'}>
              {entry.options.map((option) => {
                const isChosen = chosenFor(entry.id).includes(option.label)
                return (
                  <button
                    key={option.label}
                    type="button"
                    role={isMultiple(entry) ? 'checkbox' : 'radio'}
                    aria-checked={isChosen}
                    className={isChosen ? 'question-option question-option-on' : 'question-option'}
                    title={option.description}
                    onClick={() => {
                      choose(entry, option.label)
                    }}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      ))}
      <div className="question-actions">
        <button
          type="button"
          className="button-primary"
          disabled={!isReady}
          onClick={() => {
            onAnswer(
              question.userInputId,
              question.questions.map((entry) => answerFor(entry, chosenFor(entry.id))),
            )
          }}
        >
          {UI_TEXT.questionSubmit}
        </button>
      </div>
    </div>
  )
}
