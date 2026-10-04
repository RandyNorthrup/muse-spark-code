// Fresh implementation inspired by Lucas Bebber's Gooey Menu (MIT):
// https://codepen.io/lbebber/pen/LELBEo
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type MouseEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { GOOEY_MENU, UI_TEXT } from '../../shared/constants'
import { gooeyLayout, gooeyPillMaxWidth, gooeySecondBurst, type MenuPoint } from '../gooeyLayout'
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

/** A drawn pill's width, and whether its label had to end in an ellipsis. */
interface PillSize {
  readonly width: number
  readonly isClipped: boolean
}

/** Sizes are kept per level, so an open group's own pill keeps its place. */
function sizeKey(level: string | undefined, id: string): string {
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
  // Each pill as drawn, measured before the first paint, so the layout keeps
  // a pill of any label's width inside the panel and off its neighbours.
  const [sizes, setSizes] = useState<ReadonlyMap<string, PillSize>>(() => new Map())
  const filterId = useId()
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
  const maxWidth = gooeyPillMaxWidth(frame.viewport)
  useLayoutEffect(() => {
    // A label, a level or the panel's width may change a pill's size; the
    // state changes only when a size did.
    const drawn = buttons.current
    const measured = visibleItems.flatMap((item): (readonly [string, PillSize])[] => {
      const button = drawn.get(item.id)
      if (button === undefined) {
        return []
      }
      const text = button.querySelector('.gooey-menu-pill-label')
      const isClipped = text !== null && text.scrollWidth > text.clientWidth
      return [[sizeKey(level, item.id), { width: button.offsetWidth, isClipped }]]
    })
    const isChanged = measured.some(([key, size]) => {
      const known = sizes.get(key)
      return known?.width !== size.width || known.isClipped !== size.isClipped
    })
    if (!isChanged) {
      return
    }
    const next = new Map([...sizes, ...measured])
    setSizes(next)
  }, [visibleItems, level, sizes, maxWidth])

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

  const widthsOf = (level: string | undefined, list: readonly GooeyItem[]) =>
    list.map((item) => sizes.get(sizeKey(level, item.id))?.width ?? 0)
  const layout = gooeyLayout(frame.point, widthsOf(undefined, items), frame.viewport)
  const burst =
    (group === undefined
      ? undefined
      : gooeySecondBurst(
          layout,
          items.indexOf(group),
          widthsOf(group.id, group.children),
          frame.viewport,
        )) ?? layout
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
  const gooStyle: CSSProperties & { '--ms-goo-filter': string } = {
    '--ms-goo-filter': `url(#${filterId})`,
  }
  return (
    <div
      ref={menu}
      className="gooey-menu gooey-menu-motion-safe gooey-menu-colors-safe"
      role="menu"
      aria-label={group?.label ?? label}
      tabIndex={-1}
      onBlur={onBlur}
      onKeyDown={handleKeyDown}
    >
      <svg className="gooey-menu-defs" aria-hidden="true" width="0" height="0">
        <defs>
          <filter id={filterId} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation={GOOEY_MENU.blur} result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 18 -7"
              result="goo"
            />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
        </defs>
      </svg>
      <div className="gooey-menu-pills" style={gooStyle}>
        {visibleItems.map((item, index) => {
          const pill = burst.pills[index]
          const left = pill?.left ?? 0
          const top = pill?.top ?? 0
          // A label cut short by the ellipsis is whole in the tooltip too.
          const isClipped = sizes.get(sizeKey(level, item.id))?.isClipped === true
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
                maxWidth,
                transformOrigin: `${String(burst.origin.x - left)}px ${String(burst.origin.y - top)}px`,
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
