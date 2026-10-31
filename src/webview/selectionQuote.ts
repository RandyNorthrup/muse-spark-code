import type { MenuPoint } from './gooeyLayout'

function elementOf(node: Node | null): Element | null {
  return node instanceof Element ? node : (node?.parentElement ?? null)
}

/** Both selection endpoints and the click must belong to the same live transcript row. */
export function selectedTranscriptQuote(
  selection: Selection | null,
  target: EventTarget | null,
  point: MenuPoint,
) {
  const text = selection?.toString().trim() ?? ''
  const row = elementOf(selection?.anchorNode ?? null)?.closest<HTMLElement>('[data-entry-id]')
  const end = elementOf(selection?.focusNode ?? null)?.closest('[data-entry-id]')
  const clicked = elementOf(target instanceof Node ? target : null)?.closest('[data-entry-id]')
  const entryId = row?.dataset['entryId']
  if (
    row == null ||
    text === '' ||
    end !== row ||
    entryId === undefined ||
    !row.isConnected ||
    (clicked != null && clicked !== row)
  )
    return
  // Highlighted-text actions fan from this row's “…” button too (0.17.1). A row
  // without one keeps the pointer, or its own middle for a keyboard request.
  const button = row.querySelector<HTMLElement>('.row-actions-button')
  const bounds = row.getBoundingClientRect()
  const pointer: MenuPoint =
    point.x === 0 && point.y === 0
      ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
      : point
  return {
    text,
    entryId,
    role: row.dataset['role'] ?? 'assistant',
    origin: button ?? pointer,
  }
}
