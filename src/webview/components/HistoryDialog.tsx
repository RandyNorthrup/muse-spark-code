import { webviewKey } from '../../shared/keybindings'
// The History dialog (M6): the workspace's stored sessions grouped Today /
// Yesterday / Previous 7 days / Older, a search box over titles and
// branches, Archive / Unarchive per row and a "Show archived" switch.
// Keyboard-operable like the palette: the search box keeps focus, Up/Down
// move, Enter resumes the active row, Esc closes. The search box keeps the
// focus through a "Show archived" toggle too (M25): the switch used to take
// it, and the arrows, Enter and Esc stopped working until the next click.

import { type KeyboardEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
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
import { HistoryIcon } from './icons'
import { ListBody } from './ListBody'
import { deferred } from './DeferredSurface'

const RowView = deferred(async () => {
  const entry = await import('./HistoryRow')
  return { default: entry.HistoryRow }
}, false)
import {
  PaletteList,
  PaletteSearchInput,
  usePaletteDismiss,
  usePaletteNavigation,
} from './paletteDialog'

export interface HistoryDialogProps {
  /** undefined while the host has not answered `listSessions`. */
  readonly sessions: readonly SessionRow[] | undefined
  readonly openQuestionCounts?: Readonly<Record<string, number>>
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

function keepSearchFocus(event: MouseEvent<HTMLElement>): void {
  event.preventDefault()
}

/** What the list renders: group titles and numbered rows, in order. */
export type HistoryEntry =
  | { readonly kind: 'title'; readonly key: string; readonly title: string }
  | { readonly kind: 'row'; readonly key: string; readonly index: number; readonly row: SessionRow }

export function layoutHistory(groups: readonly SessionGroup[]): readonly HistoryEntry[] {
  let index = 0
  return groups.flatMap((group): HistoryEntry[] => [
    { kind: 'title', key: `title:${group.id}`, title: group.title },
    ...group.rows.map((row): HistoryEntry => ({
      kind: 'row',
      key: row.sessionId,
      index: index++,
      row,
    })),
  ])
}

function metaOf(row: SessionRow, nowMs: number, openCount = 0): string {
  return [
    relativeTime(row.lastActivityAt ?? row.updatedAt, nowMs),
    plural(UI_TEXT.historyTurns, row.turnCount),
    row.branch,
    row.isFork ? UI_TEXT.historyForkMark : undefined,
    openCount > 0 ? plural(UI_TEXT.openQuestionsCount, openCount) : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(' · ')
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
  const rows = groups.flatMap((group) => group.rows)
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
    if (webviewKey('history.archive', event) === 'archive') {
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
              meta={metaOf(entry.row, nowMs, props.openQuestionCounts?.[entry.row.sessionId])}
              onHover={() => {
                setActiveIndex(entry.index)
              }}
              onResume={() => {
                onResume(entry.row.sessionId)
              }}
              onSetArchived={(isRowArchived) => {
                onSetArchived(entry.row.sessionId, isRowArchived)
              }}
              onDelete={onDelete}
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
        <label className="history-toggle" onMouseDown={keepSearchFocus}>
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
