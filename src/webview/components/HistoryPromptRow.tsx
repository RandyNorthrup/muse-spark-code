import { UI_TEXT } from '../../shared/constants'
import { WEBVIEW_KEYBINDINGS } from '../../shared/keybindings'
import type { SessionRow } from '../../shared/sessions'
import { type MouseEvent, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MenuPoint } from '../gooeyLayout'
import { GooeyMenu, type GooeyItem } from './GooeyMenu'
import { CloseIcon, HistoryIcon } from './icons'
import { PaletteSessionRow } from './paletteDialog'
const ARCHIVE_KEY = WEBVIEW_KEYBINDINGS['history.archive'].archive.keys[0].key
const ROW_ID_PREFIX = 'history-row-'
export function HistoryPromptRow({
  row,
  isActive,
  isCurrent,
  isRowArchived,
  meta,
  onHover,
  onResume,
  onSetArchived,
  onSavePrompt,
  menuContainer,
}: {
  readonly menuContainer: HTMLElement | null
  readonly onSavePrompt: ((sessionId: string) => void) | undefined
  readonly row: SessionRow
  readonly isActive: boolean
  readonly isCurrent: boolean
  readonly isRowArchived: boolean
  readonly meta: string
  readonly onHover: () => void
  readonly onResume: () => void
  readonly onSetArchived: (isArchived: boolean) => void
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
    if (onSavePrompt === undefined) return
    const selection = globalThis.getSelection()
    if (selection !== null && !selection.isCollapsed && selection.toString().trim() !== '') return
    event.preventDefault()
    event.stopPropagation()
    onHover()
    setOrigin({ x: event.clientX, y: event.clientY })
  }
  const archiveLabel = isRowArchived ? UI_TEXT.historyUnarchive : UI_TEXT.historyArchive
  return (
    <>
      <PaletteSessionRow
        rowProps={{ onContextMenu: openMenu }}
        rowId={`${ROW_ID_PREFIX}${row.sessionId}`}
        title={row.title}
        isActive={isActive}
        isCurrent={isCurrent}
        meta={meta}
        // The row is the control: Delete (un)archives it from the search box.
        keyShortcuts={ARCHIVE_KEY}
        keyDescription={archiveLabel}
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
