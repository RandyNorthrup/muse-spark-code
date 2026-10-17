// The handoff dialog (M74, PLAN.md D49): the distilled brief before the new
// conversation starts. The user reviews it, edits it if needed, then starts
// the new conversation with it, or cancels and nothing starts. The open
// items its todo list starts with are listed too, so the user sees all the
// model wrote that the new conversation reads.

import type { ChangeEvent } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { Modal } from './Modal'

export interface HandoffDialogProps {
  readonly goal: string | undefined
  /** The open items the new conversation's todo list starts with. */
  readonly todos: readonly string[]
  /** The brief as edited. */
  readonly draft: string
  readonly isConfirming: boolean
  readonly onChange: (draft: string) => void
  readonly onConfirm: (brief: string) => void
  readonly onCancel: () => void
}

const BRIEF_ROWS = 12

export function HandoffDialog({
  goal,
  todos,
  draft,
  isConfirming,
  onChange,
  onConfirm,
  onCancel,
}: HandoffDialogProps) {
  const onDraftChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event.target.value)
  }
  const isEmpty = draft.trim() === ''
  return (
    <Modal title={UI_TEXT.handoffDialogTitle} titleId="handoff-title" isWide onClose={onCancel}>
      <div>
        <label className="handoff-label" htmlFor="handoff-brief">
          {UI_TEXT.handoffDialogBody}
        </label>
        {goal === undefined ? null : <p>{fill(UI_TEXT.handoffRequestCardWithGoal, { goal })}</p>}
        <textarea
          id="handoff-brief"
          className="question-input handoff-edit"
          dir="auto"
          rows={BRIEF_ROWS}
          value={draft}
          disabled={isConfirming}
          onChange={onDraftChange}
        />
        {todos.length === 0 ? null : (
          <>
            <p id="handoff-todos" className="handoff-label">
              {UI_TEXT.todoTitle}
            </p>
            <ul className="handoff-todos" aria-labelledby="handoff-todos">
              {todos.map((todo, index) => (
                // Two items may share a text (M25); the position tells them apart.
                <li key={`${String(index)}:${todo}`} dir="auto">
                  {todo}
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="handoff-actions">
          <button
            type="button"
            className="button-primary"
            disabled={isConfirming || isEmpty}
            onClick={() => {
              onConfirm(draft)
            }}
          >
            {UI_TEXT.handoffConfirm}
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={isConfirming}
            onClick={onCancel}
          >
            {UI_TEXT.questionCancel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
