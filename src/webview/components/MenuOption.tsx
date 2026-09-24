// One row of the composer's `@` and "/" lists. The textarea keeps the focus
// (a mousedown here would take it), so a row is chosen by a click or by the
// keys the composer handles.

import type { ReactNode } from 'react'

export interface MenuOptionProps {
  readonly id: string
  readonly isActive: boolean
  readonly onHover: () => void
  readonly onSelect: () => void
  readonly children: ReactNode
}

export function MenuOption({ id, isActive, onHover, onSelect, children }: MenuOptionProps) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={isActive}
      className={isActive ? 'menu-item menu-item-active' : 'menu-item'}
      onMouseEnter={onHover}
      onMouseDown={(event) => {
        event.preventDefault()
      }}
      onClick={onSelect}
    >
      {children}
    </li>
  )
}
