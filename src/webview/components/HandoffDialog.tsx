// The handoff dialog (M74, PLAN.md D49): the distilled brief before the new
// conversation starts. The user reviews it, edits it if needed, then starts
// the new conversation with it, or cancels and nothing starts.

import type { ChangeEvent } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { Modal } from './Modal'

export interface HandoffDialogProps {
  readonly goal: string | undefined
  /** The brief as edited. */
  readonly draft: string
  readonly isConfirming: boolean
  /** Behind a modal (M25). */
  readonly isInert?: boolean
  readonly onChange: (draft: string) => void
  readonly onConfirm: (brief: string) => void
  readonly onCancel: () => void
}

const BRIEF_ROWS = 12

export function HandoffDialog({
  goal,
  draft,
  isConfirming,
  isInert = false,
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
      <div inert={isInert}>
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
