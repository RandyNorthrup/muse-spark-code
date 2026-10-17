// The session board (M77, PLAN.md D49): every conversation in the window
// with its state, branch, changes and waiting approvals. Keyboard-operable
// like History: the search box keeps focus, Up/Down move, Enter resumes the
// active row, Esc closes.

import { useEffect, useMemo, useRef, useState } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { plural } from '../../shared/l10n/text'
import type { BoardRow } from '../../shared/sessionBoard'
import { scrollRowIntoView } from '../listNavigation'
import { BoardIcon } from './icons'
import { ListBody } from './ListBody'
import {
  PaletteList,
  PaletteSearchInput,
  PaletteSessionRow,
  usePaletteDismiss,
  usePaletteNavigation,
} from './paletteDialog'

export interface SessionBoardDialogProps {
  /** undefined while the host has not answered `requestSessionBoard`. */
  readonly rows: readonly BoardRow[] | undefined
  readonly currentSessionId: string | undefined
  readonly onResume: (sessionId: string, backend: BoardRow['backend']) => void
  readonly onStartBestOfN: () => void
  readonly onClose: () => void
}

const ROW_ID_PREFIX = 'board-row-'

function metaOf(row: BoardRow): string {
  const parts = [row.status === 'running' ? UI_TEXT.boardStatusRunning : UI_TEXT.boardStatusIdle]
  if (row.branch !== undefined) {
    parts.push(row.branch)
  }
  parts.push(
    row.changedFiles === undefined
      ? UI_TEXT.boardChangesUnknown
      : plural(UI_TEXT.boardChanges, row.changedFiles),
  )
  if (row.awaitingApproval) {
    parts.push(plural(UI_TEXT.boardAwaitingApproval, 1))
  }
  return parts.join(' · ')
}

export function SessionBoardDialog(props: SessionBoardDialogProps) {
  const { rows, currentSessionId } = props
  const { onResume, onStartBestOfN, onClose } = props
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (rows ?? []).filter(
      (row) =>
        needle === '' ||
        row.title.toLowerCase().includes(needle) ||
        (row.branch ?? '').toLowerCase().includes(needle),
    )
  }, [rows, query])
  const { activeIndex, setActiveIndex, handleKeyDown } = usePaletteNavigation(
    filtered.length,
    (index) => {
      const row = filtered[index]
      if (row !== undefined) {
        onResume(row.sessionId, row.backend)
      }
    },
    onClose,
  )
  const activeRow = filtered[activeIndex]

  useEffect(() => {
    if (activeRow !== undefined) {
      scrollRowIntoView(ROW_ID_PREFIX, `${activeRow.backend}:${activeRow.sessionId}`)
    }
  }, [activeRow])

  const hasList = rows !== undefined && filtered.length > 0
  let body
  if (rows === undefined) {
    body = <p className="menu-empty">{UI_TEXT.loadingOutput}</p>
  } else if (filtered.length === 0) {
    body = <p className="menu-empty">{UI_TEXT.boardEmpty}</p>
  } else {
    body = (
      <PaletteList listboxId="board-listbox" label={UI_TEXT.boardTitle}>
        {filtered.map((row, index) => (
          <PaletteSessionRow
            key={`${row.backend}:${row.sessionId}`}
            rowId={`${ROW_ID_PREFIX}${row.backend}:${row.sessionId}`}
            title={row.title}
            isActive={index === activeIndex}
            isCurrent={row.sessionId === currentSessionId}
            meta={metaOf(row)}
            extraDetails={
              row.worktreePath === undefined ? null : (
                <span className="palette-item-detail">{row.worktreePath}</span>
              )
            }
            onHover={() => {
              setActiveIndex(index)
            }}
            onResume={() => {
              onResume(row.sessionId, row.backend)
            }}
          />
        ))}
      </PaletteList>
    )
  }

  const { onDialogBlur, onDialogKeyDown } = usePaletteDismiss(search, onClose)

  return (
    <div
      className="palette history"
      role="dialog"
      aria-label={UI_TEXT.boardTitle}
      onBlur={onDialogBlur}
      onKeyDown={onDialogKeyDown}
    >
      <div className="palette-header">
        <BoardIcon />
        <PaletteSearchInput
          search={search}
          listboxId={hasList ? 'board-listbox' : undefined}
          activeRowId={
            activeRow === undefined
              ? undefined
              : `${ROW_ID_PREFIX}${activeRow.backend}:${activeRow.sessionId}`
          }
          query={query}
          onQuery={(value) => {
            setQuery(value)
            setActiveIndex(0)
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="button-secondary"
          onClick={onStartBestOfN}
          onMouseDown={(event) => {
            event.preventDefault()
          }}
        >
          {UI_TEXT.boardStartBestOfN}
        </button>
      </div>
      <ListBody>{body}</ListBody>
    </div>
  )
}
