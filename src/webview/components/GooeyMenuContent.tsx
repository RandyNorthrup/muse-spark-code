import { webviewKey } from '../../shared/keybindings'
// The chat's radial menu: a fan of blue pills, each its icon and its label,
// all one size, that scale in from where the menu opened, one after another.
// The burst began as a fresh take on Lucas Bebber's Gooey Menu (MIT,
// https://codepen.io/lbebber/pen/LELBEo); its goo filter is gone (the owner,
// 2026-10-04: "not with the faded smudge look").
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffectEvent,
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

/** A level's labels, in order: a new label set measures its width again. */
function widthKey(level: string | undefined, items: readonly GooeyItem[]): string {
  return JSON.stringify([level ?? null, ...items.map((item) => item.label)])
}

function viewportNow() {
  return { width: window.innerWidth, height: window.innerHeight }
}

function focusTokenPx(style: CSSStyleDeclaration | undefined, key: string): number {
  const value = style?.getPropertyValue(key).trim()
  return value === undefined || value === '' ? NaN : Number(value.replace('px', ''))
}

/** A fixed fan follows even reflow/transform changes that resize observers miss. */
function watchMenuGeometry(place: () => void): () => void {
  let frame: number
  const sample = () => {
    place()
    frame = window.requestAnimationFrame(sample)
  }
  place()
  frame = window.requestAnimationFrame(sample)
  document.addEventListener('scroll', place, { capture: true })
  window.addEventListener('resize', place)
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place)
  observer?.observe(document.documentElement)
  return () => {
    window.cancelAnimationFrame(frame)
    document.removeEventListener('scroll', place, true)
    window.removeEventListener('resize', place)
    observer?.disconnect()
  }
}

/** Intersect every clipping ancestor, so scrolling inside a panel can dismiss too. */
function anchorIsVisible(
  anchor: HTMLElement,
  rect: DOMRect,
  viewport: ReturnType<typeof viewportNow>,
) {
  if (!anchor.isConnected) return false
  let left = 0
  let top = 0
  let right = viewport.width
  let bottom = viewport.height
  for (let node: HTMLElement | null = anchor; node !== null; node = node.parentElement) {
    const style = window.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    if (node === anchor) continue
    const clip = node.getBoundingClientRect()
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
      left = Math.max(left, clip.left)
      right = Math.min(right, clip.right)
    }
    if (!/(auto|scroll|hidden|clip)/.test(style.overflowY)) continue
    top = Math.max(top, clip.top)
    bottom = Math.min(bottom, clip.bottom)
  }
  // The default quote anchor is a point; a button needs positive visible area.
  const isAcross =
    rect.width === 0
      ? rect.left >= left && rect.left <= right
      : rect.right > left && rect.left < right
  const isDown =
    rect.height === 0
      ? rect.top >= top && rect.top <= bottom
      : rect.bottom > top && rect.top < bottom
  return isAcross && isDown
}

export function GooeyMenuContent({ items, label, origin, onClose }: GooeyMenuProps) {
  const menu = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const closed = useRef(false)
  const parentFocus = useRef<string | undefined>(undefined)
  const [opener] = useState(() => document.activeElement)
  const [groupId, setGroup] = useState<string>()
  const [active, setActive] = useState<string>()
  // Where the menu opened and its current viewport geometry.
  const [frame, setFrame] = useState<{
    point: MenuPoint
    viewport: ReturnType<typeof viewportNow>
    spacing: number
  }>(() => ({
    point: { x: 0, y: 0 },
    viewport: viewportNow(),
    spacing: GOOEY_MENU.gap,
  }))
  // The pills whose label ends in an ellipsis, measured before the first
  // paint: their tooltip gives the whole label.
  const [clipped, setClipped] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  // Each level's shared pill width (the owner, 2026-10-09: "uniform only as
  // long as the text in the longest text button"): its labels' key to the
  // widest pill's max-content width, measured before the first paint.
  const [natural, setNatural] = useState<ReadonlyMap<string, number>>(() => new Map())
  const group = items.find((item): item is GooeyGroup => item.id === groupId && 'children' in item)
  const visibleItems = group?.children ?? items
  const returnFocus = () => {
    if (opener instanceof HTMLElement && opener.isConnected) {
      opener.focus({ preventScroll: true })
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

  const dismissAnchor = useEffectEvent(close)
  useLayoutEffect(() => {
    const place = () => {
      if (closed.current) return
      const anchor = origin instanceof HTMLElement ? origin : menu.current?.parentElement
      const rect = anchor?.getBoundingClientRect()
      const viewport = viewportNow()
      if (
        anchor !== undefined &&
        anchor !== null &&
        rect !== undefined &&
        !anchorIsVisible(anchor, rect, viewport)
      ) {
        dismissAnchor()
        return
      }
      const style = menu.current === null ? undefined : window.getComputedStyle(menu.current)
      const focusWidth = focusTokenPx(style, '--ms-focus-width')
      const focusOffset = focusTokenPx(style, '--ms-focus-offset')
      const spacing = Number.isFinite(focusWidth + focusOffset)
        ? focusWidth + focusOffset + GOOEY_MENU.outlineClearance
        : GOOEY_MENU.gap
      // An element's centre: the pills burst from the "…" itself.
      const point =
        origin !== undefined && !(origin instanceof HTMLElement)
          ? origin
          : {
              x: rect === undefined ? 0 : rect.left + rect.width / 2,
              y: rect === undefined ? 0 : rect.top + rect.height / 2,
            }
      setFrame((current) =>
        current.point.x === point.x &&
        current.point.y === point.y &&
        current.viewport.width === viewport.width &&
        current.viewport.height === viewport.height &&
        current.spacing === spacing
          ? current
          : { point, viewport, spacing },
      )
    }
    return watchMenuGeometry(place)
  }, [origin])

  const level = group?.id
  const topKey = widthKey(undefined, items)
  const levelKey = widthKey(level, visibleItems)
  const isMeasuring = !natural.has(levelKey)
  const layout = gooeyLayout(
    frame.point,
    items.length,
    frame.viewport,
    natural.get(topKey) ?? 0,
    frame.spacing,
  )
  const burst =
    (group === undefined
      ? undefined
      : gooeySecondBurst(
          layout,
          items.indexOf(group),
          group.children.length,
          frame.viewport,
          natural.get(levelKey) ?? 0,
          frame.spacing,
        )) ?? layout
  const pillWidth = burst.pills[0]?.width
  const drawnGap =
    burst.pills.length > 1
      ? (burst.pills[1]?.top ?? 0) - (burst.pills[0]?.top ?? 0) - GOOEY_MENU.pillHeight
      : frame.spacing
  useLayoutEffect(() => {
    // Drawn at max-content once, the widest pill gives the level its width.
    if (!isMeasuring) {
      return
    }
    const widths = visibleItems.map((item) =>
      Math.ceil(buttons.current.get(item.id)?.getBoundingClientRect().width ?? 0),
    )
    setNatural((current) => new Map([...current, [levelKey, Math.max(0, ...widths)]]))
  }, [isMeasuring, levelKey, visibleItems])
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
        opener.focus({ preventScroll: true })
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
    switch (webviewKey('radial.menu', event)) {
      case 'next': {
        next = enabled[(index + 1) % enabled.length]
        break
      }
      case 'previous': {
        next = enabled[(index - 1 + enabled.length) % enabled.length]
        break
      }
      case 'first': {
        next = enabled[0]
        break
      }
      case 'last': {
        next = enabled.at(-1)
        break
      }
      case 'accept': {
        const item = enabled[index]
        if (item !== undefined) {
          select(item)
        }
        break
      }
      case 'close': {
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
          const near = burst.side === 1 ? left : left + (pill?.width ?? 0)
          const openerRoom =
            origin instanceof HTMLElement
              ? Math.abs(near - frame.point.x) - origin.getBoundingClientRect().width / 2
              : drawnGap
          const outlineSpace = Math.min(drawnGap, openerRoom)
          // A label cut short by the ellipsis is whole in the tooltip too.
          const isClipped = clipped.get(pillKey(level, item.id)) === true
          const style: CSSProperties & Record<'--ms-gooey-focus-offset', string> = {
            left,
            top,
            // One size for every pill: the longest label's (the owner).
            width: isMeasuring ? 'max-content' : pill?.width,
            // The burst starts at scale(0), and a scaled rectangle measures
            // 0 px wide: the measuring pass is never painted, so it holds
            // the animation off and the burst starts on the drawn pass.
            animationName: isMeasuring ? 'none' : undefined,
            height: GOOEY_MENU.pillHeight,
            // Pull focus inward when a short panel compresses spacing or
            // a narrow fan approaches its opener; keep both neighbours clear.
            // A custom property, not an inline outline-offset, so the
            // stylesheet's pressed state keeps its ring inside the pill.
            '--ms-gooey-focus-offset': `min(var(--ms-focus-offset), calc(${String(outlineSpace)}px - var(--ms-focus-width) - ${String(GOOEY_MENU.outlineClearance)}px))`,
            transformOrigin: `${String(burst.origin.x - left)}px ${String(burst.origin.y - top)}px`,
            animationDelay: `${String(index * GOOEY_MENU.staggerMs)}ms`,
          }
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
              style={style}
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
