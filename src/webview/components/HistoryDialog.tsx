// The History dialog (M6): the workspace's stored sessions grouped Today /
// Yesterday / Previous 7 days / Older, a search box over titles and
// branches, Archive / Unarchive per row and a "Show archived" switch.
// Keyboard-operable like the palette: the search box keeps focus, Up/Down
// move, Enter resumes the active row, Esc closes.

import { type KeyboardEvent, useEffect, useMemo, useState } from 'react'
import { UI_TEXT } from '../../shared/constants'
import {
  groupSessions,
  relativeTime,
  type SessionGroup,
  type SessionListOptions,
  type SessionRow,
} from '../../shared/sessions'
import { scrollRowIntoView, wrapIndex } from '../listNavigation'
import { CloseIcon, HistoryIcon } from './icons'

export interface HistoryDialogProps {
  /** undefined while the host has not answered `listSessions`. */
  readonly sessions: readonly SessionRow[] | undefined
  readonly archivedIds: readonly string[]
  readonly currentSessionId: string | undefined
  readonly archiveAfterDays: number
  readonly now: () => number
  readonly onResume: (sessionId: string) => void
  readonly onSetArchived: (sessionId: string, isArchived: boolean) => void
  readonly onClose: () => void
}

const ROW_ID_PREFIX = 'history-row-'

/** What the list renders: group titles and numbered rows, in order. */
export type HistoryEntry =
  | { readonly kind: 'title'; readonly key: string; readonly title: string }
  | { readonly kind: 'row'; readonly key: string; readonly index: number; readonly row: SessionRow }

export function layoutHistory(groups: readonly SessionGroup[]): readonly HistoryEntry[] {
  const entries: HistoryEntry[] = []
  for (const group of groups) {
    entries.push({ kind: 'title', key: `title:${group.id}`, title: group.title })
    for (const row of group.rows) {
      entries.push({
        kind: 'row',
        key: row.sessionId,
        index: entries.filter((entry) => entry.kind === 'row').length,
        row,
      })
    }
  }
  return entries
}

function turnsLabel(row: SessionRow): string {
  return `${String(row.turnCount)} ${row.turnCount === 1 ? UI_TEXT.historyTurn : UI_TEXT.historyTurns}`
}

function metaOf(row: SessionRow, nowMs: number): string {
  const parts = [relativeTime(row.lastActivityAt ?? row.updatedAt, nowMs), turnsLabel(row)]
  if (row.branch !== undefined) {
    parts.push(row.branch)
  }
  if (row.isFork) {
    parts.push(UI_TEXT.historyForkMark)
  }
  return parts.join(' · ')
}

function RowView({
  row,
  isActive,
  isCurrent,
  isRowArchived,
  meta,
  onHover,
  onResume,
  onSetArchived,
}: {
  readonly row: SessionRow
  readonly isActive: boolean
  readonly isCurrent: boolean
  readonly isRowArchived: boolean
  readonly meta: string
  readonly onHover: () => void
  readonly onResume: () => void
  readonly onSetArchived: (isArchived: boolean) => void
}) {
  const archiveLabel = isRowArchived ? UI_TEXT.historyUnarchive : UI_TEXT.historyArchive
  return (
    <li
      id={`${ROW_ID_PREFIX}${row.sessionId}`}
      role="option"
      aria-selected={isActive}
      className={
        isActive ? 'palette-item history-row palette-item-active' : 'palette-item history-row'
      }
      onMouseEnter={onHover}
      onMouseDown={(event) => {
        // Keep the search box focused; the click still resumes.
        event.preventDefault()
      }}
      onClick={onResume}
    >
      <span className="palette-item-text">
        <span className="palette-item-label">
          {row.title}
          {isCurrent ? (
            <span className="badge history-current">{UI_TEXT.historyCurrent}</span>
          ) : null}
        </span>
        <span className="palette-item-detail">{meta}</span>
      </span>
      <button
        type="button"
        className="icon-button history-archive"
        title={archiveLabel}
        aria-label={`${archiveLabel}: ${row.title}`}
        onMouseDown={(event) => {
          event.preventDefault()
        }}
        onClick={(event) => {
          event.stopPropagation()
          onSetArchived(!isRowArchived)
        }}
      >
        <CloseIcon />
      </button>
    </li>
  )
}

export function HistoryDialog(props: HistoryDialogProps) {
  const { sessions, archivedIds, currentSessionId, archiveAfterDays, now } = props
  const { onResume, onSetArchived, onClose } = props
  const [query, setQuery] = useState('')
  const [isShowingArchived, setIsShowingArchived] = useState(false)
  const [storedIndex, setActiveIndex] = useState(0)
  const nowMs = now()

  const options = useMemo(
    (): SessionListOptions => ({
      nowMs,
      query,
      archivedIds: new Set(archivedIds),
      archiveAfterDays,
      isShowingArchived,
    }),
    [nowMs, query, archivedIds, archiveAfterDays, isShowingArchived],
  )
  const groups: readonly SessionGroup[] = useMemo(
    () => groupSessions(sessions ?? [], options),
    [sessions, options],
  )
  // Titles and rows in display order; rows also numbered for the keyboard.
  const entries = useMemo(() => layoutHistory(groups), [groups])
  const rows = useMemo(
    () => entries.flatMap((entry) => (entry.kind === 'row' ? [entry.row] : [])),
    [entries],
  )
  const activeIndex = storedIndex < rows.length ? storedIndex : 0
  const activeRow = rows[activeIndex]

  useEffect(() => {
    if (activeRow !== undefined) {
      scrollRowIntoView(ROW_ID_PREFIX, activeRow.sessionId)
    }
  }, [activeRow])

  const move = (delta: number) => {
    setActiveIndex(wrapIndex(activeIndex, delta, rows.length))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault()
        move(1)
        break
      }
      case 'ArrowUp': {
        event.preventDefault()
        move(-1)
        break
      }
      case 'Enter': {
        event.preventDefault()
        if (activeRow !== undefined) {
          onResume(activeRow.sessionId)
        }
        break
      }
      case 'Escape': {
        event.preventDefault()
        onClose()
        break
      }
      default: {
        break
      }
    }
  }

  let body
  if (sessions === undefined) {
    body = <p className="menu-empty">{UI_TEXT.loadingOutput}</p>
  } else if (rows.length === 0) {
    body = (
      <p className="menu-empty">
        {sessions.length === 0 ? UI_TEXT.historyEmpty : UI_TEXT.historyNoMatches}
      </p>
    )
  } else {
    body = (
      <ul
        id="history-listbox"
        role="listbox"
        aria-label={UI_TEXT.historyLabel}
        className="palette-list"
      >
        {entries.map((entry) =>
          entry.kind === 'title' ? (
            <li key={entry.key} role="presentation" className="palette-group-title">
              {entry.title}
            </li>
          ) : (
            <RowView
              key={entry.key}
              row={entry.row}
              isActive={entry.index === activeIndex}
              isCurrent={entry.row.sessionId === currentSessionId}
              isRowArchived={archivedIds.includes(entry.row.sessionId)}
              meta={metaOf(entry.row, nowMs)}
              onHover={() => {
                setActiveIndex(entry.index)
              }}
              onResume={() => {
                onResume(entry.row.sessionId)
              }}
              onSetArchived={(isRowArchived) => {
                onSetArchived(entry.row.sessionId, isRowArchived)
              }}
            />
          ),
        )}
      </ul>
    )
  }

  return (
    <div className="palette history" role="dialog" aria-label={UI_TEXT.historyLabel}>
      <div className="palette-header">
        <HistoryIcon />
        <input
          className="palette-filter"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="history-listbox"
          aria-autocomplete="list"
          aria-activedescendant={
            activeRow === undefined ? undefined : `${ROW_ID_PREFIX}${activeRow.sessionId}`
          }
          placeholder={UI_TEXT.historySearchPlaceholder}
          value={query}
          autoFocus
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={handleKeyDown}
          onBlur={(event) => {
            // The archived switch takes focus while toggled; anything else closes.
            if (!event.currentTarget.parentElement?.parentElement?.contains(event.relatedTarget)) {
              onClose()
            }
          }}
        />
        <label className="history-toggle">
          <input
            type="checkbox"
            checked={isShowingArchived}
            onChange={(event) => {
              setIsShowingArchived(event.target.checked)
              setActiveIndex(0)
            }}
          />
          {UI_TEXT.historyShowArchived}
        </label>
      </div>
      <div className="palette-body">{body}</div>
    </div>
  )
}
