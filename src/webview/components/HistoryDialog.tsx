import { webviewKey } from '../../shared/keybindings'
// The History dialog (M6): the workspace's stored sessions grouped Today /
// Yesterday / Previous 7 days / Older, a search box over titles and
// branches, Archive / Unarchive per row and a "Show Archived" switch.
// Keyboard-operable like the palette: the search box keeps focus, Up/Down
// move, Enter resumes the active row, Esc closes. The search box keeps the
// focus through a "Show Archived" toggle too (M25): the switch used to take
// it, and the arrows, Enter and Esc stopped working until the next click.

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { plural } from '../../shared/l10n/text'
import type { BookmarkRecord } from '../../shared/protocol'
import {
  groupSessions,
  relativeTime,
  type SessionGroup,
  type SessionListOptions,
  type SessionRow,
} from '../../shared/sessions'
import { scrollRowIntoView } from '../listNavigation'
import { deferred } from './DeferredSurface'
import { HistoryIcon } from './icons'
import { ListBody } from './ListBody'
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
  readonly onSavePrompt?: (sessionId: string) => void
  readonly onResume: (sessionId: string) => void
  readonly onSetArchived: (sessionId: string, isArchived: boolean) => void
  /** Set where the host can delete: the host confirms, naming the conversation, then removes it. */
  readonly onDelete?: ((sessionId: string) => void) | undefined
  /** This workspace's bookmarks on the listed backend (M88, PLAN.md D67). */
  readonly bookmarks?: readonly BookmarkRecord[] | undefined
  /** Toggle one row's bookmark; the title rides the set for a new bookmark. Absent, no stars. */
  readonly onToggleBookmark?:
    ((sessionId: string, isBookmarked: boolean, title: string) => void) | undefined
  readonly onClose: () => void
}

const ROW_ID_PREFIX = 'history-row-'
// Archives or restores the highlighted row from the search box (M37).
const NO_BOOKMARKS: readonly BookmarkRecord[] = []

/** What the list renders: group titles and numbered rows, in order. */
export type HistoryEntry =
  | { readonly kind: 'title'; readonly key: string; readonly title: string }
  | { readonly kind: 'row'; readonly key: string; readonly index: number; readonly row: SessionRow }

export function layoutHistory(groups: readonly SessionGroup[]): readonly HistoryEntry[] {
  const entries: HistoryEntry[] = []
  let index = 0
  for (const group of groups) {
    entries.push({ kind: 'title', key: `title:${group.id}`, title: group.title })
    for (const row of group.rows) {
      entries.push({
        kind: 'row',
        key: row.sessionId,
        index: index++,
        row,
      })
    }
  }
  return entries
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

const RowView = deferred(async () => {
  const module = await import('./HistoryPromptRow')
  return { default: module.HistoryPromptRow }
})

export function HistoryDialog(props: HistoryDialogProps) {
  const [menuContainer, setMenuContainer] = useState<HTMLDivElement | null>(null)
  const { sessions, archivedIds, currentSessionId, archiveAfterDays, now } = props
  const { onResume, onSetArchived, onDelete, onToggleBookmark, onClose } = props
  const [query, setQuery] = useState('')
  const [isShowingArchived, setIsShowingArchived] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const nowMs = now()
  // The Bookmarked group, its stars and Alt+B arrive with the toggle; without
  // it the dialog lists as it always did.
  const bookmarkRefs =
    onToggleBookmark === undefined ? NO_BOOKMARKS : (props.bookmarks ?? NO_BOOKMARKS)

  const options = useMemo(
    (): SessionListOptions => ({
      nowMs,
      query,
      archivedIds: new Set(archivedIds),
      archiveAfterDays,
      isShowingArchived,
      bookmarks: bookmarkRefs,
    }),
    [nowMs, query, archivedIds, archiveAfterDays, isShowingArchived, bookmarkRefs],
  )
  const groups: readonly SessionGroup[] = useMemo(
    () => groupSessions(sessions ?? [], options),
    [sessions, options],
  )
  // Titles and rows in display order; rows also numbered for the keyboard.
  const entries = useMemo(() => layoutHistory(groups), [groups])
  const rows = groups.flatMap((group) => group.rows)
  const bookmarkedIds = useMemo(
    () => new Set(bookmarkRefs.map((ref) => ref.sessionId)),
    [bookmarkRefs],
  )
  const listedIds = useMemo(() => new Set((sessions ?? []).map((row) => row.sessionId)), [sessions])
  // A bookmarked session no page names: stored title in, only Remove applies.
  const isUnavailable = (row: SessionRow): boolean =>
    bookmarkedIds.has(row.sessionId) && !listedIds.has(row.sessionId)
  const {
    activeIndex,
    setActiveIndex,
    handleKeyDown: handlePaletteKeyDown,
  } = usePaletteNavigation(
    rows.length,
    (index) => {
      const row = rows[index]
      if (row !== undefined && !isUnavailable(row)) {
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
      // Only on the highlighted row; with text selected, Delete edits it. A
      // session no page names has no archive: only Remove applies.
      if (
        activeRow !== undefined &&
        event.currentTarget.value === '' &&
        !isUnavailable(activeRow)
      ) {
        event.preventDefault()
        if (onDelete !== undefined && event.shiftKey) {
          onDelete(activeRow.sessionId)
        } else {
          onSetArchived(activeRow.sessionId, !archivedIds.includes(activeRow.sessionId))
        }
      }
      return
    }
    if (webviewKey('history.bookmark', event) === 'toggle') {
      if (activeRow !== undefined && onToggleBookmark !== undefined) {
        // Option+B would otherwise insert ∫ on macOS.
        event.preventDefault()
        onToggleBookmark(
          activeRow.sessionId,
          !bookmarkedIds.has(activeRow.sessionId),
          activeRow.title,
        )
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
              onSavePrompt={props.onSavePrompt}
              menuContainer={menuContainer}
              row={entry.row}
              isActive={entry.index === activeIndex}
              isCurrent={entry.row.sessionId === currentSessionId}
              isRowArchived={archivedIds.includes(entry.row.sessionId)}
              isBookmarked={bookmarkedIds.has(entry.row.sessionId)}
              isUnavailable={isUnavailable(entry.row)}
              meta={
                isUnavailable(entry.row)
                  ? UI_TEXT.bookmarkUnavailable
                  : metaOf(entry.row, nowMs, props.openQuestionCounts?.[entry.row.sessionId])
              }
              onHover={() => {
                setActiveIndex(entry.index)
              }}
              onResume={() => {
                if (!isUnavailable(entry.row)) {
                  onResume(entry.row.sessionId)
                }
              }}
              onSetArchived={(isRowArchived) => {
                onSetArchived(entry.row.sessionId, isRowArchived)
              }}
              onDelete={onDelete}
              onToggleBookmark={
                onToggleBookmark === undefined
                  ? undefined
                  : (isBookmarked) => {
                      onToggleBookmark(entry.row.sessionId, isBookmarked, entry.row.title)
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
        {props.onSavePrompt === undefined ? null : (
          <button
            type="button"
            className="button-secondary"
            disabled={activeRow === undefined || isUnavailable(activeRow)}
            onClick={() => {
              if (activeRow !== undefined && !isUnavailable(activeRow))
                props.onSavePrompt?.(activeRow.sessionId)
            }}
          >
            {UI_TEXT.promptSave}
          </button>
        )}
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
      <div ref={setMenuContainer} />
    </div>
  )
}
