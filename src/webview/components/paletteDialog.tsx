import { webviewKey } from '../../shared/keybindings'
// The combobox-dialog shell the History dialog and the session board share
// (M77): one search box over rows, Up/Down to move, Enter to resume the
// active row, Esc to close, and rows that keep the search box focused for
// the mouse.

import {
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useState,
} from 'react'
import { UI_TEXT } from '../../shared/constants'
import { wrapIndex } from '../listNavigation'

/**
 * The arrows/Enter/Escape contract of a combobox dialog's search box, over
 * its rows. Enter resumes the row at the active index through the caller.
 */
export function usePaletteNavigation(
  count: number,
  onEnterIndex: (index: number) => void,
  onClose: () => void,
): {
  readonly activeIndex: number
  readonly setActiveIndex: (index: number) => void
  readonly handleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
} {
  const [storedIndex, setActiveIndex] = useState(0)
  const activeIndex = storedIndex < count ? storedIndex : 0
  const move = (delta: number) => {
    setActiveIndex(wrapIndex(activeIndex, delta, count))
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (webviewKey('dialog', event)) {
      case 'next': {
        event.preventDefault()
        move(1)
        break
      }
      case 'previous': {
        event.preventDefault()
        move(-1)
        break
      }
      case 'accept': {
        event.preventDefault()
        onEnterIndex(activeIndex)
        break
      }
      case 'close': {
        event.preventDefault()
        onClose()
        break
      }
      default: {
        break
      }
    }
  }
  return { activeIndex, setActiveIndex, handleKeyDown }
}

/** Anything taking the focus outside the dialog closes it. */
export function usePaletteDismiss(
  search: RefObject<HTMLInputElement | null>,
  onClose: () => void,
): {
  readonly onDialogBlur: (event: FocusEvent<HTMLDivElement>) => void
  readonly onDialogKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
} {
  const onDialogBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      onClose()
    }
  }
  const onDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The search box handles its own Escape.
    if (webviewKey('dialog', event) !== 'close' || event.target === search.current) {
      return
    }
    event.preventDefault()
    onClose()
  }
  return { onDialogBlur, onDialogKeyDown }
}

/** The search box every combobox dialog filters through. */
export function PaletteSearchInput({
  search,
  listboxId,
  activeRowId,
  query,
  onQuery,
  onKeyDown,
}: {
  readonly search: RefObject<HTMLInputElement | null>
  /** Only a list that is there can be controlled. */
  readonly listboxId: string | undefined
  readonly activeRowId: string | undefined
  readonly query: string
  readonly onQuery: (query: string) => void
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}): ReactNode {
  return (
    <input
      ref={search}
      className="palette-filter"
      type="text"
      role="combobox"
      // Only a list that is there can be controlled (seen in a translated
      // table, M40: a search matching nothing left the reference dangling).
      aria-expanded={listboxId !== undefined}
      aria-controls={listboxId}
      aria-autocomplete="list"
      aria-activedescendant={activeRowId}
      placeholder={UI_TEXT.historySearchPlaceholder}
      value={query}
      autoFocus
      onChange={(event) => {
        onQuery(event.target.value)
      }}
      onKeyDown={onKeyDown}
    />
  )
}

/** The rows' listbox: the id, label and rows differ per dialog. */
export function PaletteList({
  listboxId,
  label,
  children,
}: {
  readonly listboxId: string
  readonly label: string
  readonly children: ReactNode
}): ReactNode {
  return (
    <ul id={listboxId} role="listbox" aria-label={label} className="palette-list">
      {children}
    </ul>
  )
}

/** One session row: the label, its state line, and each dialog's extras. */
export function PaletteSessionRow({
  rowId,
  title,
  isActive,
  isCurrent,
  meta,
  extraDetails,
  action,
  keyShortcuts,
  keyDescription,
  onHover,
  onResume,
}: {
  readonly rowId: string
  readonly title: string
  readonly isActive: boolean
  readonly isCurrent: boolean
  readonly meta: string
  readonly extraDetails?: ReactNode
  readonly action?: ReactNode
  readonly keyShortcuts?: string
  readonly keyDescription?: string
  readonly onHover: () => void
  readonly onResume: () => void
}): ReactNode {
  return (
    <li
      id={rowId}
      role="option"
      aria-selected={isActive}
      aria-keyshortcuts={keyShortcuts}
      aria-description={keyDescription}
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
          {title}
          {isCurrent ? (
            <span className="badge history-current">{UI_TEXT.historyCurrent}</span>
          ) : null}
        </span>
        <span className="palette-item-detail">{meta}</span>
        {extraDetails}
      </span>
      {action}
    </li>
  )
}
