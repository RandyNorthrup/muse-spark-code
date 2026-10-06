import { type MouseEvent } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { WEBVIEW_KEYBINDINGS } from '../../shared/keybindings'
import { type SessionRow } from '../../shared/sessions'
import { PaletteSessionRow } from './paletteDialog'
import { CloseIcon } from './icons'

const ROW_ID_PREFIX = 'history-row-'
const ARCHIVE_KEY = WEBVIEW_KEYBINDINGS['history.archive'].archive.keys[0].key
const DELETE_SHORTCUT = 'Shift+Delete'
function keepSearchFocus(event: MouseEvent<HTMLElement>): void {
  event.preventDefault()
}

export function HistoryRow({
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
  readonly onDelete: ((sessionId: string) => void) | undefined
}) {
  const archiveLabel = isRowArchived ? UI_TEXT.historyUnarchive : UI_TEXT.historyArchive
  const deletionLabel = UI_TEXT.memoryDeleteAction
  return (
    <PaletteSessionRow
      rowId={`${ROW_ID_PREFIX}${row.sessionId}`}
      title={row.title}
      isActive={isActive}
      isCurrent={isCurrent}
      meta={meta}
      // The row is the control: Delete (un)archives it from the search box.
      keyShortcuts={onDelete === undefined ? ARCHIVE_KEY : `${ARCHIVE_KEY} ${DELETE_SHORTCUT}`}
      keyDescription={onDelete === undefined ? archiveLabel : `${archiveLabel} · ${deletionLabel}`}
      action={
        <>
          {/* For the mouse only: a button inside an option is still reachable by
              assistive technology (WCAG 4.1.2, M37); the keyboard uses Delete. */}
          <span
            className="icon-button history-archive"
            title={`${archiveLabel} (${ARCHIVE_KEY})`}
            aria-hidden="true"
            onMouseDown={keepSearchFocus}
            onClick={(event) => {
              event.stopPropagation()
              onSetArchived(!isRowArchived)
            }}
          >
            <CloseIcon />
          </span>
          {onDelete !== undefined && (
            <span
              className="icon-button history-archive"
              title={`${deletionLabel} (${DELETE_SHORTCUT})`}
              aria-hidden="true"
              onMouseDown={keepSearchFocus}
              onClick={(event) => {
                event.stopPropagation()
                onDelete(row.sessionId)
              }}
            >
              {deletionLabel}
            </span>
          )}
        </>
      }
      onHover={onHover}
      onResume={onResume}
    />
  )
}
