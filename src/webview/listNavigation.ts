// Keyboard-list helpers shared by the palette and the History dialog: the
// wrap-around row index and the "keep the active row visible" scroll.

/** The index `delta` rows away, wrapping at both ends; 0 for an empty list. */
export function wrapIndex(index: number, delta: number, length: number): number {
  return length === 0 ? 0 : (index + delta + length) % length
}

/** Scrolls the row element with the given id prefix + id into view. */
export function scrollRowIntoView(prefix: string, id: string): void {
  document.querySelector(`#${prefix}${CSS.escape(id)}`)?.scrollIntoView({ block: 'nearest' })
}
