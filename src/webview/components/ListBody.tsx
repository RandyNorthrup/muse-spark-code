// The scrolling list of the palette and the History dialog (M37). It is a
// Tab stop of its own, so the list scrolls from the keyboard too (WCAG
// 2.1.1); a click on it keeps the focus in the dialog's filter box, which
// owns the arrows, Enter and Escape.

import type { ReactNode } from 'react'

export function ListBody({ children }: { readonly children: ReactNode }) {
  return (
    <div
      className="palette-body"
      tabIndex={0}
      onMouseDown={(event) => {
        event.preventDefault()
      }}
    >
      {children}
    </div>
  )
}
