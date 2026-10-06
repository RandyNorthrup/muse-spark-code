// A removal waits behind Undo before its secret is deleted (M95: ten
// seconds, or the next start if the window closes first — the host owns
// the wait; this bar only offers the way back).

import { UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import type { PendingRemoval } from '../../../shared/modelsPanel'

export interface UndoBarProps {
  readonly removals: readonly PendingRemoval[]
  readonly onUndo: (providerId: string) => void
}

export function UndoBar({ removals, onUndo }: UndoBarProps) {
  if (removals.length === 0) {
    return null
  }
  return (
    <div className="models-undo-bar" role="status">
      {removals.map((removal) => (
        <p key={removal.providerId} className="models-undo-item">
          <span>{fill(UI_TEXT.providerRemoved, { id: removal.providerId })}</span>
          <button
            type="button"
            className="models-button"
            onClick={() => {
              onUndo(removal.providerId)
            }}
          >
            {UI_TEXT.undoAction}
          </button>
        </p>
      ))}
    </div>
  )
}
