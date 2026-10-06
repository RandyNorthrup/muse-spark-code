// The History dialog (M6): the workspace's stored sessions grouped Today /
// Yesterday / Previous 7 days / Older, a search box over titles and
// branches, Archive / Unarchive per row and a "Show archived" switch.
// Keyboard-operable like the palette: the search box keeps focus, Up/Down
// move, Enter resumes the active row, Esc closes. The search box keeps the
// focus through a "Show archived" toggle too (M25): the switch used to take
// it, and the arrows, Enter and Esc stopped working until the next click.

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { plural } from '../../shared/l10n/text'
import {
  groupSessions,
  relativeTime,
  type SessionGroup,
  type SessionListOptions,
  type SessionRow,
} from '../../shared/sessions'
import { scrollRowIntoView } from '../listNavigation'
import { CloseIcon, HistoryIcon } from './icons'
import { ListBody } from './ListBody'
import {
  PaletteList,
  PaletteSearchInput,
  PaletteSessionRow,
  usePaletteDismiss,
  usePaletteNavigation,
} from './paletteDialog'

export interface HistoryDialogProps {
  /** undefined while the host has not answered `listSessions`. */
  readonly sessions: readonly SessionRow[] | undefined
  readonly archivedIds: readonly string[]
  readonly currentSessionId: string | undefined
  readonly archiveAfterDays: number
  readonly now: () => number
  readonly onResume: (sessionId: string) => void
  readonly onSetArchived: (sessionId: string, isArchived: boolean) => void
  /** Muse Code only. The host confirms deletion and waits for its terminal notification. */
  readonly onDelete?: (sessionId: string) => void
  readonly onClose: () => void
}

const ROW_ID_PREFIX = 'history-row-'
// Archives or restores the highlighted row from the search box (M37).
const ARCHIVE_KEY = 'Delete'
const DELETE_SHORTCUT = 'Shift+Delete'

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

function metaOf(row: SessionRow, nowMs: number): string {
  const parts = [
    relativeTime(row.lastActivityAt ?? row.updatedAt, nowMs),
    plural(UI_TEXT.historyTurns, row.turnCount),
  ]
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
  onDelete,
}: {
  readonly row: SessionRow
  readonly isActive: boolean
  readonly isCurrent: boolean
  readonly isRowArchived: boolean
  readonly meta: string
  readonly onHover: () => void
  readonly onResume: () => void
  readonly onSetArchived: (isArchived: boolean) => void
  readonly onDelete: (() => void) | undefined
}) {
  const archiveLabel = isRowArchived ? UI_TEXT.historyUnarchive : UI_TEXT.historyArchive
  return (
    <PaletteSessionRow
      rowId={`${ROW_ID_PREFIX}${row.sessionId}`}
      title={row.title}
      isActive={isActive}
      isCurrent={isCurrent}
      meta={meta}
      // The row is the control: Delete (un)archives it from the search box.
      keyShortcuts={onDelete === undefined ? ARCHIVE_KEY : `${ARCHIVE_KEY} ${DELETE_SHORTCUT}`}
      keyDescription={
        onDelete === undefined
          ? archiveLabel
          : `${archiveLabel} (${ARCHIVE_KEY}) · ${UI_TEXT.memoryDeleteAction} (${DELETE_SHORTCUT})`
      }
      action={
        <>
          {/* For the mouse only: a button inside an option is still reachable by
              assistive technology (WCAG 4.1.2, M37); the keyboard uses Delete. */}
          <span
            className="icon-button history-archive"
            title={`${archiveLabel} (${ARCHIVE_KEY})`}
            aria-hidden="true"
            onMouseDown={(event) => {
              event.preventDefault()
            }}
            onClick={(event) => {
              event.stopPropagation()
              onSetArchived(!isRowArchived)
            }}
          >
            <CloseIcon />
          </span>
          {onDelete !== undefined && (
            <span
              className="icon-button history-archive history-delete"
              title={`${UI_TEXT.memoryDeleteAction} (${DELETE_SHORTCUT})`}
              aria-hidden="true"
              onMouseDown={(event) => {
                event.preventDefault()
              }}
              onClick={(event) => {
                event.stopPropagation()
                onDelete()
              }}
            >
              {UI_TEXT.memoryDeleteAction}
            </span>
          )}
        </>
      }
      onHover={onHover}
      onResume={onResume}
    />
  )
}

export function HistoryDialog(props: HistoryDialogProps) {
  const { sessions, archivedIds, currentSessionId, archiveAfterDays, now } = props
  const { onResume, onSetArchived, onDelete, onClose } = props
  const [query, setQuery] = useState('')
  const [isShowingArchived, setIsShowingArchived] = useState(false)
  const search = useRef<HTMLInputElement>(null)
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
  const {
    activeIndex,
    setActiveIndex,
    handleKeyDown: handlePaletteKeyDown,
  } = usePaletteNavigation(
    rows.length,
    (index) => {
      const row = rows[index]
      if (row !== undefined) {
        onResume(row.sessionId)
      }
    },
    onClose,
  )
  const activeRow = rows[activeIndex]

  useEffect(() => {
    if (activeRow !== undefined) {
      scrollRowIntoView(ROW_ID_PREFIX, activeRow.sessionId)
    }
  }, [activeRow])

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === ARCHIVE_KEY) {
      // Only on the highlighted row; with text selected, Delete edits it.
      if (activeRow !== undefined && event.currentTarget.value === '') {
        event.preventDefault()
        if (onDelete !== undefined && event.shiftKey) {
          onDelete(activeRow.sessionId)
        } else {
          onSetArchived(activeRow.sessionId, !archivedIds.includes(activeRow.sessionId))
        }
      }
      return
    }
    handlePaletteKeyDown(event)
  }

  const hasList = sessions !== undefined && rows.length > 0
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
      <PaletteList listboxId="history-listbox" label={UI_TEXT.historyLabel}>
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
              onDelete={
                onDelete === undefined
                  ? undefined
                  : () => {
                      onDelete(entry.row.sessionId)
                    }
              }
            />
          ),
        )}
      </PaletteList>
    )
  }

  const { onDialogBlur, onDialogKeyDown } = usePaletteDismiss(search, onClose)

  return (
    <div
      className="palette history"
      role="dialog"
      aria-label={UI_TEXT.historyLabel}
      onBlur={onDialogBlur}
      onKeyDown={onDialogKeyDown}
    >
      <div className="palette-header">
        <HistoryIcon />
        <PaletteSearchInput
          search={search}
          listboxId={hasList ? 'history-listbox' : undefined}
          activeRowId={
            activeRow === undefined ? undefined : `${ROW_ID_PREFIX}${activeRow.sessionId}`
          }
          query={query}
          onQuery={(value) => {
            setQuery(value)
            setActiveIndex(0)
          }}
          onKeyDown={handleKeyDown}
        />
        <label
          className="history-toggle"
          onMouseDown={(event) => {
            // A click toggles the switch without taking the focus.
            event.preventDefault()
          }}
        >
          <input
            type="checkbox"
            checked={isShowingArchived}
            onChange={(event) => {
              setIsShowingArchived(event.target.checked)
              setActiveIndex(0)
              // Toggled from the keyboard: back to the search box and its keys.
              search.current?.focus()
            }}
          />
          {UI_TEXT.historyShowArchived}
        </label>
      </div>
      <ListBody>{body}</ListBody>
    </div>
  )
}
