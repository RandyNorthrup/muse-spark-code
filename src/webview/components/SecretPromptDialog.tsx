// The secret-prompt dialog (M92e, PLAN.md D71): the host held a prompt for a
// detected secret and sent nothing. The user sends it anyway or goes back
// and edits it; the transcript shows the redacted text either way. Escape,
// the close button and a click on the backdrop dismiss for editing, as the
// draft is already back in the composer.

import { UI_TEXT } from '../../shared/constants'
import { Modal } from './Modal'

export interface SecretPromptDialogProps {
  /** The held prompt with secrets redacted, as the transcript will show it. */
  readonly redactedText: string
  readonly onSendAnyway: () => void
  readonly onEdit: () => void
}

export function SecretPromptDialog({
  redactedText,
  onSendAnyway,
  onEdit,
}: SecretPromptDialogProps) {
  return (
    <Modal title={UI_TEXT.secretPromptTitle} titleId="secret-prompt-title" onClose={onEdit}>
      <div>
        <p>{UI_TEXT.secretPromptDetail}</p>
        <blockquote className="approval-prompt" dir="auto">
          {redactedText}
        </blockquote>
        <div className="question-actions">
          <button type="button" className="button-primary" onClick={onSendAnyway}>
            {UI_TEXT.secretPromptSendAnyway}
          </button>
          <button type="button" className="button-secondary" onClick={onEdit}>
            {UI_TEXT.secretPromptEdit}
          </button>
        </div>
      </div>
    </Modal>
  )
}
