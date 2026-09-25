// A small anchored menu above a composer button (the "+" attach menu and the
// permission Modes menu). Keyboard-first: the list itself holds focus,
// Up/Down move, Enter or Space activate, Left/Right go to the optional
// footer control, Esc closes; losing focus closes it. Rows keep the list
// focused on mousedown so a click activates without blurring it shut.

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { CheckIcon } from './icons'

export interface MenuEntry {
  readonly id: string
  readonly label: string
  readonly detail?: string
  readonly icon?: ReactNode
  /** Present on radio-style rows; the checked one shows a tick. */
  readonly isChecked?: boolean
}

export interface PopoverMenuProps {
  /** Accessible name of the menu. */
  readonly label: string
  /** Header text; the header is omitted without one. */
  readonly title?: string
  /** Right-hand side of the header (a key hint). */
  readonly hint?: ReactNode
  readonly entries: readonly MenuEntry[]
  readonly footer?: ReactNode
  /** Which composer edge the menu hugs. */
  readonly align: 'left' | 'right'
  readonly onSelect: (id: string) => void
  /** Left/Right arrows while the menu is open; return true when handled. */
  readonly onStep?: (direction: -1 | 1) => boolean
  readonly onClose: () => void
}

const STEP_LEFT = -1
const STEP_RIGHT = 1

export function PopoverMenu(props: PopoverMenuProps) {
  const { label, title, hint, entries, footer, align, onSelect, onStep, onClose } = props
  const listRef = useRef<HTMLUListElement>(null)
  const checkedIndex = entries.findIndex((entry) => entry.isChecked === true)
  const [activeIndex, setActiveIndex] = useState(Math.max(checkedIndex, 0))

  useEffect(() => {
    listRef.current?.focus()
  }, [])

  const move = (delta: number) => {
    if (entries.length > 0) {
      setActiveIndex((activeIndex + delta + entries.length) % entries.length)
    }
  }

  const activate = (index: number) => {
    const entry = entries[index]
    if (entry !== undefined) {
      onSelect(entry.id)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
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
      case 'ArrowLeft':
      case 'ArrowRight': {
        const direction = event.key === 'ArrowRight' ? STEP_RIGHT : STEP_LEFT
        if (onStep?.(direction) === true) {
          event.preventDefault()
        }
        break
      }
      case 'Enter':
      case ' ': {
        event.preventDefault()
        activate(activeIndex)
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

  return (
    <div className={`popover popover-${align}`} role="dialog" aria-label={label}>
      {title === undefined ? null : (
        <div className="popover-header">
          <span className="popover-title">{title}</span>
          {hint}
        </div>
      )}
      <ul
        ref={listRef}
        className="popover-list"
        role="menu"
        aria-label={label}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          // Clicks on the footer control keep focus here (mousedown is
          // prevented); anything else taking focus closes the menu.
          if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) {
            onClose()
          }
        }}
      >
        {entries.map((entry, index) => (
          <li
            key={entry.id}
            role={entry.isChecked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={entry.isChecked}
            className={index === activeIndex ? 'menu-item menu-item-active' : 'menu-item'}
            onMouseEnter={() => {
              setActiveIndex(index)
            }}
            onMouseDown={(event) => {
              event.preventDefault()
            }}
            onClick={() => {
              activate(index)
            }}
          >
            {entry.icon === undefined ? null : <span className="menu-item-icon">{entry.icon}</span>}
            <span className="menu-item-text">
              <span className="menu-item-label">{entry.label}</span>
              {entry.detail === undefined ? null : (
                <span className="menu-item-detail">{entry.detail}</span>
              )}
            </span>
            {entry.isChecked === true ? <CheckIcon title={UI_TEXT.menuCurrent} /> : null}
          </li>
        ))}
      </ul>
      {footer === undefined ? null : <div className="popover-footer">{footer}</div>}
    </div>
  )
}
