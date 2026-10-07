// One suggestion with its reason (M95: the default model and a session
// budget, each with Accept or Change). The engine's values come from local
// facts only; the panel only shows them.

import { UI_TEXT } from '../../../shared/constants'

export interface SuggestionCardProps {
  readonly title: string
  readonly reason: string
  readonly value: string
  readonly accepted: boolean
  readonly onAccept: () => void
  readonly onChange: () => void
}

export function SuggestionCard({
  title,
  reason,
  value,
  accepted,
  onAccept,
  onChange,
}: SuggestionCardProps) {
  return (
    <div className="models-suggestion">
      <h4 className="models-suggestion-title">{title}</h4>
      <p className="models-suggestion-value">{value}</p>
      <p className="models-suggestion-reason">{reason}</p>
      <div className="models-row-actions">
        <button
          type="button"
          className="models-button-primary"
          disabled={accepted}
          onClick={onAccept}
        >
          {UI_TEXT.suggestionAccept}
        </button>
        <button type="button" className="models-button" onClick={onChange}>
          {UI_TEXT.suggestionChange}
        </button>
      </div>
    </div>
  )
}
