// Closes an open menu when the user presses anywhere outside it or moves
// focus out of it (M25), the way a native menu behaves; Escape stays with
// the menu's own key handler.

import { type FocusEvent, type RefObject, useEffect } from 'react'

export function useDismiss(
  container: RefObject<HTMLElement | null>,
  isOpen: boolean,
  onClose: () => void,
): (event: FocusEvent<HTMLElement>) => void {
  useEffect(() => {
    if (!isOpen) {
      return
    }
    const onPointerDown = (event: Event) => {
      const { target } = event
      if (target instanceof Node && container.current?.contains(target) !== true) {
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [container, isOpen, onClose])
  // For the container's onBlur: focus that left for somewhere outside closes
  // it; focus that vanished (a click on plain text) is the pointer's job.
  return (event) => {
    const next = event.relatedTarget
    if (isOpen && next !== null && !event.currentTarget.contains(next)) {
      onClose()
    }
  }
}
