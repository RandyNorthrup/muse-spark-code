import { UI_TEXT } from '../../shared/constants'
import { HistoryIcon, NewConversationIcon } from './icons'

export interface HeaderProps {
  readonly title: string
  readonly isFocusView: boolean
  readonly onNewConversation: () => void
}

export function Header({ title, isFocusView, onNewConversation }: HeaderProps) {
  return (
    <header className="header">
      <h1 className="header-title">{title}</h1>
      <div className="header-actions">
        {isFocusView ? <span className="badge">{UI_TEXT.focusViewBadge}</span> : null}
        <button
          type="button"
          className="icon-button"
          title={UI_TEXT.historyTitle}
          aria-label={UI_TEXT.historyTitle}
          disabled
        >
          <HistoryIcon />
        </button>
        <button
          type="button"
          className="icon-button"
          title={UI_TEXT.newConversationTitle}
          aria-label={UI_TEXT.newConversationTitle}
          onClick={onNewConversation}
        >
          <NewConversationIcon />
        </button>
      </div>
    </header>
  )
}
