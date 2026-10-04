// Fresh implementation inspired by Lucas Bebber's Gooey Menu (MIT):
// https://codepen.io/lbebber/pen/LELBEo
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { GOOEY_MENU } from '../../shared/constants'
import { gooeyLayout, gooeySecondBurst, type MenuPoint } from '../gooeyLayout'
import { useDismiss } from '../useDismiss'

interface ItemBase {
  readonly id: string
  readonly label: string
  readonly icon: ReactNode
  readonly disabled?: boolean
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
  const [group, setGroup] = useState<GooeyGroup>()
  const [active, setActive] = useState<string>()
  const [hovered, setHovered] = useState<string>()
  const [layout, setLayout] = useState(() =>
    gooeyLayout({ x: 0, y: 0 }, 0, { width: 0, height: 0 }),
  )
  const filterId = useId()
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
      setGroup(item)
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
  const labelledId = hovered ?? active
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
        return point === undefined || item.id !== labelledId ? null : (
          <span
            key={item.id}
            aria-hidden="true"
            className={`gooey-menu-label ${point.x > window.innerWidth / 2 ? 'gooey-menu-label-left' : ''}`}
            style={{ left: point.x, top: point.y }}
          >
            {item.label}
          </span>
        )
      })}
    </div>
  )
}
