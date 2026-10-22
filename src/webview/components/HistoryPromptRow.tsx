import { UI_TEXT } from '../../shared/constants'
import { WEBVIEW_KEYBINDINGS } from '../../shared/keybindings'
import type { SessionRow } from '../../shared/sessions'
import { type MouseEvent, useState } from 'react'
import type { SessionRecapView } from '../state/uiState'
import { createPortal } from 'react-dom'
import type { MenuPoint } from '../gooeyLayout'
import { GooeyMenu, type GooeyItem } from './GooeyMenu'
import { CloseIcon, HistoryIcon, StarIcon } from './icons'
import { PaletteSessionRow } from './paletteDialog'
const ARCHIVE_KEY = WEBVIEW_KEYBINDINGS['history.archive'].archive.keys[0].key
const ROW_ID_PREFIX = 'history-row-'
const DELETE_SHORTCUT = 'Shift+Delete'
const BOOKMARK_SHORTCUT = 'Alt+B'

/** The row's keyboard, as the option announces it (M88, PLAN.md D67). */
function keyShortcuts(isBookmarked: boolean, isUnavailable: boolean, canDelete: boolean): string {
  if (isUnavailable) {
    return BOOKMARK_SHORTCUT
  }
  const keys: string[] = [ARCHIVE_KEY]
  if (canDelete) {
    keys.push(DELETE_SHORTCUT)
  }
  if (isBookmarked) {
    keys.push(BOOKMARK_SHORTCUT)
  }
  return keys.join(' ')
}

/** The row's keyboard in words: a bookmarked row names both commands. */
function keyDescription(
  archiveLabel: string,
  isBookmarked: boolean,
  isUnavailable: boolean,
  canDelete: boolean,
): string {
  if (isUnavailable) {
    return UI_TEXT.bookmarkRemove
  }
  const parts = [archiveLabel]
  if (canDelete) {
    parts.push(UI_TEXT.memoryDeleteAction)
  }
  if (isBookmarked) {
    parts.push(UI_TEXT.bookmarkRemove)
  }
  return parts.join(' · ')
}

export function HistoryPromptRow({
  row,
  isActive,
  isCurrent,
  isRowArchived,
  isBookmarked,
  isUnavailable,
  meta,
  recap,
  isRecapPending,
  onHover,
  onResume,
  onSetArchived,
  onDelete,
  onToggleBookmark,
  onRecap,
  onSavePrompt,
  menuContainer,
}: {
  readonly onDelete: ((sessionId: string) => void) | undefined
  readonly onRecap: (() => void) | undefined
  readonly menuContainer: HTMLElement | null
  readonly onSavePrompt: ((sessionId: string) => void) | undefined
  readonly row: SessionRow
  readonly isActive: boolean
  readonly isCurrent: boolean
  readonly isRowArchived: boolean
  readonly isBookmarked: boolean
  /** A bookmarked session no page names: only Remove applies. */
  readonly isUnavailable: boolean
  readonly meta: string
  readonly recap: SessionRecapView | undefined
  readonly isRecapPending: boolean
  readonly onHover: () => void
  readonly onResume: () => void
  readonly onSetArchived: (isArchived: boolean) => void
  readonly onToggleBookmark: ((isBookmarked: boolean) => void) | undefined
}) {
  const [origin, setOrigin] = useState<MenuPoint>()
  const closeMenu = () => {
    setOrigin(undefined)
  }
  const items: GooeyItem[] =
    onSavePrompt === undefined
      ? []
      : [
          {
            id: 'save',
            label: UI_TEXT.promptSave,
            icon: <HistoryIcon />,
            onSelect: () => {
              closeMenu()
              onSavePrompt(row.sessionId)
            },
          },
        ]
  const openMenu = (event: MouseEvent<HTMLElement>) => {
    if (onSavePrompt === undefined || isUnavailable) return
    const selection = globalThis.getSelection()
    if (selection !== null && !selection.isCollapsed && selection.toString().trim() !== '') return
    event.preventDefault()
    event.stopPropagation()
    onHover()
    setOrigin({ x: event.clientX, y: event.clientY })
  }
  const archiveLabel = isRowArchived ? UI_TEXT.historyUnarchive : UI_TEXT.historyArchive
  const bookmarkLabel = isBookmarked ? UI_TEXT.bookmarkRemove : UI_TEXT.bookmarkAdd
  const recapBody = recap === undefined ? undefined : (recap.text ?? recap.reason ?? recap.outcome)
  return (
    <>
      <PaletteSessionRow
        rowProps={{ onContextMenu: openMenu }}
        rowId={`${ROW_ID_PREFIX}${row.sessionId}`}
        title={row.title}
        isActive={isActive}
        isCurrent={isCurrent}
        meta={meta}
        extraDetails={
          <>
            {isBookmarked ? <span className="sr-only">{UI_TEXT.bookmarkedState}</span> : null}
            {recapBody === undefined ? (
              isRecapPending ? (
                <span className="palette-item-detail">{UI_TEXT.historyRecapLoading}</span>
              ) : null
            ) : (
              <span className="palette-item-detail">
                {recap?.title === undefined ? null : `${recap.title}: `}
                {recapBody}
              </span>
            )}
          </>
        }
        // The row is the control: Delete (un)archives it from the search box,
        // Alt+B toggles its bookmark.
        keyShortcuts={keyShortcuts(isBookmarked, isUnavailable, onDelete !== undefined)}
        keyDescription={keyDescription(
          archiveLabel,
          isBookmarked,
          isUnavailable,
          onDelete !== undefined,
        )}
        action={
          <>
            {onToggleBookmark === undefined ? null : (
              // For the mouse only, like the archive control below: the
              // keyboard toggles from the search box with Alt+B.
              <span
                className="icon-button history-bookmark"
                title={`${bookmarkLabel} (${BOOKMARK_SHORTCUT})`}
                aria-hidden="true"
                data-bookmarked={isBookmarked}
                onMouseDown={(event) => {
                  event.preventDefault()
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleBookmark(!isBookmarked)
                }}
              >
                <StarIcon filled={isBookmarked} />
              </span>
            )}
            {isUnavailable ? null : (
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
                {onDelete === undefined ? null : (
                  <span
                    className="icon-button history-archive"
                    title={`${UI_TEXT.memoryDeleteAction} (${DELETE_SHORTCUT})`}
                    aria-hidden="true"
                    onMouseDown={(event) => {
                      event.preventDefault()
                    }}
                    onClick={(event) => {
                      event.stopPropagation()
                      onDelete(row.sessionId)
                    }}
                  >
                    {UI_TEXT.memoryDeleteAction}
                  </span>
                )}
                {onRecap === undefined ? null : (
                  <span
                    className="icon-button history-archive"
                    title={UI_TEXT.historyRecap}
                    aria-hidden="true"
                    onMouseDown={(event) => {
                      event.preventDefault()
                    }}
                    onClick={(event) => {
                      event.stopPropagation()
                      onRecap()
                    }}
                  >
                    {UI_TEXT.historyRecap}
                  </span>
                )}
              </>
            )}
          </>
        }
        onHover={onHover}
        onResume={onResume}
      />
      {origin === undefined || menuContainer === null
        ? null
        : createPortal(
            <GooeyMenu items={items} label={row.title} origin={origin} onClose={closeMenu} />,
            menuContainer,
          )}
    </>
  )
}
