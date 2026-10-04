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
import {
  gooeyLabelBox,
  gooeyLayout,
  gooeySecondBurst,
  type GooeyLabelSize,
  type MenuPoint,
} from '../gooeyLayout'
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

export function GooeyMenu({ items, label, origin, onClose }: GooeyMenuProps) {
  const menu = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const closed = useRef(false)
  const parentFocus = useRef<string | undefined>(undefined)
  const [opener] = useState(() => document.activeElement)
  const [groupId, setGroup] = useState<string>()
  const [active, setActive] = useState<string>()
  const [hovered, setHovered] = useState<string>()
  // The shown label, measured once drawn, so its place can keep it inside
  // the panel and off every bubble (lane W).
  const labelRef = useRef<HTMLSpanElement>(null)
  const [labelSize, setLabelSize] = useState<GooeyLabelSize & { readonly id: string }>()
  const [layout, setLayout] = useState(() =>
    gooeyLayout({ x: 0, y: 0 }, 0, { width: 0, height: 0 }),
  )
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
      const point =
        origin !== undefined && !(origin instanceof HTMLElement)
          ? origin
          : { x: rect?.right ?? 0, y: rect?.top ?? 0 }
      setLayout(
        gooeyLayout(point, items.length, { width: window.innerWidth, height: window.innerHeight }),
      )
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place)
    observer?.observe(document.documentElement)
    return () => {
      observer?.disconnect()
    }
  }, [origin, items.length])

  useLayoutEffect(() => {
    // A parent's re-render passes new item objects; focus stays put unless the
    // level changed (its bubbles unmounted) or Escape asked for the group.
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

  const groupIndex = group === undefined ? -1 : items.findIndex((item) => item.id === group.id)
  const groupPoint = layout.points[groupIndex]
  const burst =
    groupPoint === undefined
      ? layout
      : gooeySecondBurst(groupPoint, visibleItems.length, {
          width: window.innerWidth,
          height: window.innerHeight,
        })
  const select = (item: GooeyItem) => {
    if (item.disabled === true || closed.current) {
      return
    }
    if ('children' in item) {
      setHovered(undefined)
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
          setHovered(undefined)
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
  const labelledId = hovered ?? active ?? visibleItems[0]?.id
  useLayoutEffect(() => {
    const label = labelRef.current
    if (label === null || labelledId === undefined) {
      return
    }
    const width = label.offsetWidth
    const height = label.offsetHeight
    if (labelSize?.id !== labelledId || labelSize.width !== width || labelSize.height !== height) {
      setLabelSize({ id: labelledId, width, height })
    }
    // The label appears once the layout has points and takes its text from
    // the items, so either changing measures it again.
  }, [labelledId, labelSize, visibleItems, layout, groupId])
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
      <div className="gooey-menu-bubbles" style={gooStyle}>
        {visibleItems.map((item, index) => {
          const point = burst.points[index]
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
              title={item.title}
              aria-disabled={item.disabled === true || undefined}
              aria-haspopup={'children' in item ? 'menu' : undefined}
              tabIndex={item.id === active ? 0 : -1}
              className="gooey-menu-bubble"
              style={{
                left: point?.x,
                top: point?.y,
                transformOrigin: `${String(burst.origin.x - (point?.x ?? 0) + GOOEY_MENU.bubbleSize / 2)}px ${String(burst.origin.y - (point?.y ?? 0) + GOOEY_MENU.bubbleSize / 2)}px`,
              }}
              onFocus={() => {
                setActive(item.id)
              }}
              onMouseEnter={() => {
                setHovered(item.id)
              }}
              onMouseLeave={() => {
                setHovered(undefined)
              }}
              onClick={() => {
                select(item)
              }}
            >
              <span aria-hidden="true">{item.icon}</span>
            </button>
          )
        })}
      </div>
      {visibleItems.map((item, index) => {
        const point = burst.points[index]
        if (point === undefined || item.id !== labelledId) {
          return null
        }
        // Drawn unseen at its bubble first, to be measured; then placed.
        const box =
          labelSize?.id === item.id
            ? gooeyLabelBox(burst, index, labelSize, {
                width: window.innerWidth,
                height: window.innerHeight,
              })
            : undefined
        return (
          <span
            key={item.id}
            ref={labelRef}
            aria-hidden="true"
            className="gooey-menu-label"
            style={
              box === undefined
                ? { left: point.x, top: point.y, visibility: 'hidden' }
                : { left: box.left, top: box.top }
            }
          >
            {item.label}
          </span>
        )
      })}
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
