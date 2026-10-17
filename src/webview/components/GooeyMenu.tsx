import { type KeyboardEvent, type ReactNode, type MouseEvent, useRef, useState } from 'react'
import { webviewKey } from '../../shared/keybindings'
import { UI_TEXT } from '../../shared/constants'
import type { MenuPoint } from '../gooeyLayout'
import type { GooeyItem } from './GooeyMenuContent'
import { deferred } from './DeferredSurface'
import { MoreIcon } from './icons'
export type { GooeyItem } from './GooeyMenuContent'
export const GooeyMenu = deferred(async () => {
  const module = await import('./GooeyMenuContent')
  return { default: module.GooeyMenuContent }
})

/** What the opener shows for a moment after an action, as "Copied" (the review of F2). */
export interface RowMenuFeedback {
  readonly icon: ReactNode
  readonly title: string
}

/** One opener and one menu per row; selection belongs to the transcript's quote menu. */
export function useRowMenu(
  items: readonly GooeyItem[],
  label: string,
  quoteMenu: ReactNode = null,
  feedback?: RowMenuFeedback,
) {
  const button = useRef<HTMLButtonElement>(null)
  const [origin, setOrigin] = useState<MenuPoint | HTMLElement>()
  const close = () => {
    setOrigin(undefined)
  }
  const open = (point: MenuPoint | undefined) => {
    if (items.length === 0 || button.current === null) {
      return
    }
    button.current.focus()
    setOrigin(point ?? button.current)
  }
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    const selection = globalThis.getSelection()
    const row = event.currentTarget
    // Only text selected in this row is its quote menu's; a selection in
    // another row leaves this row's menu to open (the review of F2, P1).
    if (
      selection !== null &&
      !selection.isCollapsed &&
      selection.toString().trim() !== '' &&
      (row.contains(selection.anchorNode) || row.contains(selection.focusNode))
    ) {
      close()
      return
    }
    if (items.length === 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    open({ x: event.clientX, y: event.clientY })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!(items.length > 0 && webviewKey('row.menu', event) === 'open')) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    open(undefined)
  }
  return {
    rowProps: { onContextMenu, onKeyDown },
    isOpen: origin !== undefined || quoteMenu !== null,
    close,
    menu:
      items.length === 0 ? null : (
        <div className="row-actions">
          <button
            ref={button}
            type="button"
            className="row-actions-button"
            aria-label={UI_TEXT.rowMoreActions}
            title={feedback?.title ?? UI_TEXT.rowMoreActions}
            aria-haspopup="menu"
            aria-expanded={origin !== undefined && quoteMenu === null}
            onClick={() => {
              if (origin === undefined) {
                open(undefined)
              } else {
                close()
              }
            }}
          >
            {feedback?.icon ?? <MoreIcon />}
          </button>
          {origin === undefined || quoteMenu !== null ? null : (
            <GooeyMenu keepFocus items={items} label={label} origin={origin} onClose={close} />
          )}
        </div>
      ),
  }
}
