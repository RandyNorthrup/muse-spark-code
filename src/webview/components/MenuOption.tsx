// One row of the composer's `@` and "/" lists. The textarea keeps the focus
// (a mousedown here would take it), so a row is chosen by a click or by the
// keys the composer handles.

import type { ReactNode } from 'react'

export interface MenuOptionProps {
  readonly id: string
  readonly tip?: string | undefined
  readonly isActive: boolean
  readonly onHover: () => void
  readonly onSelect: () => void
  readonly children: ReactNode
}

export function MenuOption({ id, tip, isActive, onHover, onSelect, children }: MenuOptionProps) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={isActive}
      title={tip}
      aria-describedby={tip === undefined ? undefined : `${id}-tip`}
      className={isActive ? 'menu-item menu-item-active' : 'menu-item'}
      onMouseEnter={onHover}
      onMouseDown={(event) => {
        event.preventDefault()
      }}
      onClick={onSelect}
    >
      {children}
      {tip === undefined ? null : (
        <span id={`${id}-tip`} className="sr-only" aria-hidden="true">
          {tip}
        </span>
      )}
    </li>
  )
}
