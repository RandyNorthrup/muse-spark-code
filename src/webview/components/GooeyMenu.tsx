// The chat's radial menu: a fan of blue pills, each its icon and its label,
// all one size, that scale in from where the menu opened, one after another.
// The burst began as a fresh take on Lucas Bebber's Gooey Menu (MIT,
// https://codepen.io/lbebber/pen/LELBEo); its goo filter is gone (the owner,
// 2026-10-04: "not with the faded smudge look").
import {
  type KeyboardEvent,
  type ReactNode,
  type MouseEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { GOOEY_MENU, UI_TEXT } from '../../shared/constants'
import { gooeyLayout, gooeySecondBurst, type MenuPoint } from '../gooeyLayout'
import { useDismiss } from '../useDismiss'
import { MoreIcon } from './icons'

interface ItemBase {
  readonly id: string
  readonly label: string
  readonly icon: ReactNode
  readonly disabled?: boolean
  readonly title?: string | undefined
}
interface GooeyAction extends ItemBase {
  readonly onSelect: () => void
}
interface GooeyGroup extends ItemBase {
  readonly children: readonly GooeyAction[]
}
export type GooeyItem = GooeyAction | GooeyGroup

interface GooeyMenuProps {
  readonly items: readonly GooeyItem[]
  readonly label: string
  /** Without an explicit origin, use the enclosing quote-menu anchor. */
  readonly origin?: MenuPoint | HTMLElement
  readonly onClose: () => void
}

/** A pill's key per level: the same item may sit in the first burst and a group's. */
function pillKey(level: string | undefined, id: string): string {
  return JSON.stringify([level ?? null, id])
}

function viewportNow() {
  return { width: window.innerWidth, height: window.innerHeight }
}

export function GooeyMenu({ items, label, origin, onClose }: GooeyMenuProps) {
  const menu = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const closed = useRef(false)
  const parentFocus = useRef<string | undefined>(undefined)
  const [opener] = useState(() => document.activeElement)
  const [groupId, setGroup] = useState<string>()
  const [active, setActive] = useState<string>()
  // Where the menu opened, and the panel's size: placed again on a resize.
  const [frame, setFrame] = useState(() => ({ point: { x: 0, y: 0 }, viewport: viewportNow() }))
  // The pills whose label ends in an ellipsis, measured before the first
  // paint: their tooltip gives the whole label.
  const [clipped, setClipped] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const group = items.find((item): item is GooeyGroup => item.id === groupId && 'children' in item)
  const visibleItems = group?.children ?? items
  const returnFocus = () => {
    if (opener instanceof HTMLElement && opener.isConnected) {
      opener.focus()
    }
  }
  const close = () => {
    if (closed.current) {
      return
    }

    closed.current = true
    returnFocus()
    onClose()
  }
  const onBlur = useDismiss(menu, true, close)

  useLayoutEffect(() => {
    const place = () => {
      const anchor = origin instanceof HTMLElement ? origin : menu.current?.parentElement
      const rect = anchor?.getBoundingClientRect()
      // An element's centre: the pills burst from the "…" itself.
      const point =
        origin !== undefined && !(origin instanceof HTMLElement)
          ? origin
          : {
              x: rect === undefined ? 0 : rect.left + rect.width / 2,
              y: rect === undefined ? 0 : rect.top + rect.height / 2,
            }
      const viewport = viewportNow()
      setFrame((current) =>
        current.point.x === point.x &&
        current.point.y === point.y &&
        current.viewport.width === viewport.width &&
        current.viewport.height === viewport.height
          ? current
          : { point, viewport },
      )
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place)
    observer?.observe(document.documentElement)
    return () => {
      observer?.disconnect()
    }
  }, [origin])

  const level = group?.id
  const layout = gooeyLayout(frame.point, items.length, frame.viewport)
  const burst =
    (group === undefined
      ? undefined
      : gooeySecondBurst(layout, items.indexOf(group), group.children.length, frame.viewport)) ??
    layout
  const pillWidth = burst.pills[0]?.width
  useLayoutEffect(() => {
    // A label, a level or the panel's width may clip a label; the state
    // changes only when the clipped set did.
    const drawn = buttons.current
    const measured = visibleItems.map((item): readonly [string, boolean] => {
      const text = drawn.get(item.id)?.querySelector('.gooey-menu-pill-label')
      const isClipped = text !== null && text !== undefined && text.scrollWidth > text.clientWidth
      return [pillKey(level, item.id), isClipped]
    })
    if (measured.every(([key, isClipped]) => clipped.get(key) === isClipped)) {
      return
    }
    setClipped(new Map([...clipped, ...measured]))
  }, [visibleItems, level, clipped, pillWidth])

  useLayoutEffect(() => {
    // A parent's re-render passes new item objects; focus stays put unless the
    // level changed (its pills unmounted) or Escape asked for the group.
    const focused = document.activeElement
    const isKeeps = visibleItems.some((item) => buttons.current.get(item.id) === focused)
    if (isKeeps && parentFocus.current === undefined) {
      return
    }
    const first =
      visibleItems.find((item) => item.id === parentFocus.current) ??
      visibleItems.find((item) => item.disabled !== true)
    parentFocus.current = undefined
    if (first === undefined) {
      menu.current?.focus()
    } else {
      buttons.current.get(first.id)?.focus()
    }
  }, [visibleItems])

  useLayoutEffect(
    () => () => {
      if (
        (menu.current?.contains(document.activeElement) === true ||
          document.activeElement === document.body) &&
        opener instanceof HTMLElement &&
        opener.isConnected
      ) {
        opener.focus()
      }
    },
    [opener],
  )

  const select = (item: GooeyItem) => {
    if (item.disabled === true || closed.current) {
      return
    }
    if ('children' in item) {
      setGroup(item.id)
    } else {
      item.onSelect()
    }
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = visibleItems.filter((item) => item.disabled !== true)
    const index = enabled.findIndex((item) => item.id === active)
    let next: GooeyItem | undefined
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight': {
        next = enabled[(index + 1) % enabled.length]
        break
      }
      case 'ArrowUp':
      case 'ArrowLeft': {
        next = enabled[(index - 1 + enabled.length) % enabled.length]
        break
      }
      case 'Home': {
        next = enabled[0]
        break
      }
      case 'End': {
        next = enabled.at(-1)
        break
      }
      case 'Enter':
      case ' ': {
        const item = enabled[index]
        if (item !== undefined) {
          select(item)
        }
        break
      }
      case 'Escape': {
        if (group === undefined) {
          close()
        } else {
          parentFocus.current = group.id
          setGroup(undefined)
        }
        break
      }
      default: {
        return
      }
    }
    event.preventDefault()
    event.stopPropagation()
    if (next !== undefined) {
      buttons.current.get(next.id)?.focus()
    }
  }
  return (
    <div
      ref={menu}
      className="gooey-menu gooey-menu-colors-safe"
      role="menu"
      aria-label={group?.label ?? label}
      tabIndex={-1}
      onBlur={onBlur}
      onKeyDown={handleKeyDown}
    >
      <div className="gooey-menu-pills">
        {visibleItems.map((item, index) => {
          const pill = burst.pills[index]
          const left = pill?.left ?? 0
          const top = pill?.top ?? 0
          // A label cut short by the ellipsis is whole in the tooltip too.
          const isClipped = clipped.get(pillKey(level, item.id)) === true
          return (
            <button
              key={item.id}
              ref={(button) => {
                if (button === null) {
                  buttons.current.delete(item.id)
                } else {
                  buttons.current.set(item.id, button)
                }
              }}
              type="button"
              role="menuitem"
              aria-label={item.label}
              title={item.title ?? (isClipped ? item.label : undefined)}
              aria-disabled={item.disabled === true || undefined}
              aria-haspopup={'children' in item ? 'menu' : undefined}
              tabIndex={item.id === active ? 0 : -1}
              className="gooey-menu-pill"
              style={{
                left,
                top,
                // One size for every pill, whatever its label (the owner).
                width: pill?.width,
                height: GOOEY_MENU.pillHeight,
                transformOrigin: `${String(burst.origin.x - left)}px ${String(burst.origin.y - top)}px`,
                animationDelay: `${String(index * GOOEY_MENU.staggerMs)}ms`,
              }}
              onFocus={() => {
                setActive(item.id)
              }}
              onClick={() => {
                select(item)
              }}
            >
              <span className="gooey-menu-pill-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="gooey-menu-pill-label">{item.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

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
    if (!(
      items.length > 0 &&
      (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))
    )) {
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
            <GooeyMenu items={items} label={label} origin={origin} onClose={close} />
          )}
        </div>
      ),
  }
}
