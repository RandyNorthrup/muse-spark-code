import { webviewKey } from '../../shared/keybindings'
// A small anchored menu above a composer button (the "+" attach menu and the
// permission Modes menu). Keyboard-first: the list itself holds focus,
// Up/Down move, Enter or Space activate, Left/Right go to the optional
// footer control, Esc closes; losing focus closes it. Rows keep the list
// focused on mousedown so a click activates without blurring it shut.

import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
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
  /** Pointer coordinates for hosts without a contributed native context menu. */
  readonly anchor?: { readonly x: number; readonly y: number }
  readonly onSelect: (id: string) => void
  /** Left/Right arrows while the menu is open; return true when handled. */
  readonly onStep?: (direction: -1 | 1) => boolean
  readonly onClose: () => void
}

const STEP_LEFT = -1
const STEP_RIGHT = 1

export function PopoverMenu(props: PopoverMenuProps) {
  const { label, title, hint, entries, footer, align, anchor, onSelect, onStep, onClose } = props
  const popoverRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const checkedIndex = entries.findIndex((entry) => entry.isChecked === true)
  const [activeIndex, setActiveIndex] = useState(Math.max(checkedIndex, 0))

  useEffect(() => {
    listRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const popover = popoverRef.current
    if (anchor === undefined || popover === null) {
      return
    }
    const place = () => {
      // CSSOM property writes work under the webview's unchanged strict CSP.
      popover.style.left = `${String(Math.max(0, Math.min(anchor.x, window.innerWidth - popover.offsetWidth)))}px`
      popover.style.top = `${String(Math.max(0, Math.min(anchor.y, window.innerHeight - popover.offsetHeight)))}px`
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(document.documentElement)
    observer.observe(popover)
    return () => {
      observer.disconnect()
      popover.style.removeProperty('left')
      popover.style.removeProperty('top')
    }
  }, [anchor])

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
    switch (webviewKey('popover', event)) {
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
      case 'decrease':
      case 'increase': {
        const direction = webviewKey('popover', event) === 'increase' ? STEP_RIGHT : STEP_LEFT
        if (onStep?.(direction) === true) {
          event.preventDefault()
        }
        break
      }
      case 'accept': {
        event.preventDefault()
        activate(activeIndex)
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

  return (
    <div
      ref={popoverRef}
      className={`popover popover-${anchor === undefined ? align : 'pointer'}`}
      role="dialog"
      aria-label={label}
    >
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
