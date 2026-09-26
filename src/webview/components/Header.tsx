// The panel header: the conversation title (click to rename once a session
// exists, M6), the Focus view badge, the History clock and New conversation.

import { type KeyboardEvent, useState } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { plural } from '../../shared/l10n/text'
import { HistoryIcon, NewConversationIcon } from './icons'

export interface HeaderProps {
  readonly title: string
  readonly isFocusView: boolean
  readonly onNewConversation: () => void
  /** Undefined while the shell is connecting (the buttons are inert then). */
  readonly onOpenHistory?: (() => void) | undefined
  /** Present once a session exists: the title becomes editable. */
  readonly onRename?: ((name: string) => void) | undefined
  /** The agents pill (M14): shown once a subagent exists in this conversation. */
  readonly agentCount?: number
  readonly runningAgentCount?: number
  /** Background tasks still running (M46): they show the pill too. */
  readonly runningTaskCount?: number
  readonly onOpenAgents?: (() => void) | undefined
}

/** The pill's words: the agents, the running background tasks, or both (M14, M46). */
function pillLabel(agentCount: number, runningTaskCount: number): string {
  const parts = [
    agentCount > 0 ? plural(UI_TEXT.agentsCount, agentCount) : undefined,
    runningTaskCount > 0 ? plural(UI_TEXT.backgroundTasksCount, runningTaskCount) : undefined,
  ].filter((part) => part !== undefined)
  return parts.join(' · ')
}

function TitleEditor({
  title,
  onRename,
}: {
  readonly title: string
  readonly onRename: (name: string) => void
}) {
  const [draft, setDraft] = useState<string | undefined>(undefined)
  if (draft === undefined) {
    return (
      <button
        type="button"
        className="header-title-button"
        title={UI_TEXT.renameTitle}
        onClick={() => {
          setDraft(title === UI_TEXT.untitledConversation ? '' : title)
        }}
      >
        <h1 className="header-title" dir="auto">
          {title}
        </h1>
      </button>
    )
  }
  const commit = () => {
    const name = draft.trim()
    setDraft(undefined)
    if (name !== '' && name !== title) {
      onRename(name)
    }
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(undefined)
    }
  }
  return (
    <input
      className="header-title-input"
      type="text"
      aria-label={UI_TEXT.renameTitle}
      placeholder={UI_TEXT.renamePlaceholder}
      value={draft}
      autoFocus
      onChange={(event) => {
        setDraft(event.target.value)
      }}
      onKeyDown={handleKeyDown}
      onBlur={commit}
    />
  )
}

export function Header({
  title,
  isFocusView,
  onNewConversation,
  onOpenHistory,
  onRename,
  agentCount = 0,
  runningAgentCount = 0,
  runningTaskCount = 0,
  onOpenAgents,
}: HeaderProps) {
  const isPillShown = agentCount > 0 || runningTaskCount > 0
  const isAnyRunning = runningAgentCount > 0 || runningTaskCount > 0
  return (
    <header className="header">
      {onRename === undefined ? (
        <h1 className="header-title" dir="auto">
          {title}
        </h1>
      ) : (
        <TitleEditor title={title} onRename={onRename} />
      )}
      <div className="header-actions">
        {isFocusView ? <span className="badge">{UI_TEXT.focusViewBadge}</span> : null}
        {onOpenAgents !== undefined && isPillShown ? (
          <button
            type="button"
            className="agents-pill"
            title={agentCount > 0 ? UI_TEXT.agentsPillTitle : UI_TEXT.backgroundTasksPillTitle}
            onClick={onOpenAgents}
          >
            <span
              className={isAnyRunning ? 'agent-dot agent-dot-running' : 'agent-dot agent-dot-done'}
              aria-hidden="true"
            />
            {pillLabel(agentCount, runningTaskCount)}
          </button>
        ) : null}
        <button
          type="button"
          className="icon-button"
          title={UI_TEXT.historyTitle}
          aria-label={UI_TEXT.historyTitle}
          disabled={onOpenHistory === undefined}
          onMouseDown={(event) => {
            // Keep the dialog's search box focused so a second click
            // toggles the dialog closed instead of blurring it shut and
            // reopening it.
            event.preventDefault()
          }}
          onClick={onOpenHistory}
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
