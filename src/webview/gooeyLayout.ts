import { GOOEY_MENU } from '../shared/constants'

export interface MenuPoint {
  readonly x: number
  readonly y: number
}

interface MenuViewport {
  readonly width: number
  readonly height: number
}

/** Which way the pills reach from the origin: 1 to its right, -1 to its left. */
type GooeySide = -1 | 1

/** A pill's top-left corner and width; every pill is `GOOEY_MENU.pillHeight` high. */
export interface GooeyPill {
  readonly left: number
  readonly top: number
  readonly width: number
}

export interface GooeyPillLayout {
  /** Where the pills burst from: the origin of their scale-in. */
  readonly origin: MenuPoint
  readonly side: GooeySide
  readonly pills: readonly GooeyPill[]
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

/**
 * Every pill's width (the owner, 2026-10-04: "they should be a uniform
 * size"): the widest that keeps the whole fan inside a 320 px panel, so no
 * label grows its pill; a longer label ends in an ellipsis. A panel
 * narrower still gives each pill its width less the edge padding.
 */
export function gooeyPillWidth(viewport: MenuViewport): number {
  const fixed = GOOEY_MENU.narrowPanel - 2 * GOOEY_MENU.edgePadding - GOOEY_MENU.bow
  return Math.max(0, Math.min(fixed, viewport.width - 2 * GOOEY_MENU.edgePadding))
}

/**
 * The pills beside `anchor`, one row each, centred on its height and moved
 * whole to stay inside the panel. Their near ends sit on half an ellipse
 * around the anchor: the pills level with it reach farthest, the outer ones
 * curve back, so the rows read as a fan. When the fan would leave the panel
 * it moves back towards (and over) the origin all at once, keeping its arc;
 * only a panel too narrow for the whole arc gets a shallower one. Rows never
 * overlap.
 */
function column(
  anchor: MenuPoint,
  side: GooeySide,
  count: number,
  viewport: MenuViewport,
): readonly GooeyPill[] {
  if (count === 0) {
    return []
  }
  const pad = GOOEY_MENU.edgePadding
  const height = GOOEY_MENU.pillHeight
  // A panel too short for the resting gap shares out what room there is.
  const room = viewport.height - 2 * pad
  const gap = count > 1 ? Math.min(GOOEY_MENU.gap, (room - count * height) / (count - 1)) : 0
  const step = height + gap
  const total = count * height + (count - 1) * gap
  const first = clamp(anchor.y - total / 2, pad, viewport.height - pad - total)
  const tops = Array.from({ length: count }, (_, index) => first + index * step)
  // How far out each row bows, 0 to 1: its middle's distance from the
  // anchor's height, against half a step past the outermost row, so even
  // that one curves out a little.
  const lifts = tops.map((top) => top + height / 2 - anchor.y)
  const span = Math.max(...lifts.map((lift) => Math.abs(lift))) + step / 2
  const curve = lifts.map((lift) => Math.sqrt(1 - (lift / span) ** 2))
  const width = gooeyPillWidth(viewport)
  const spread = Math.max(...curve) - Math.min(...curve)
  const across = viewport.width - 2 * pad
  const bow = spread > 0 ? clamp((across - width) / spread, 0, GOOEY_MENU.bow) : GOOEY_MENU.bow
  const lefts = curve.map((bend) => {
    const near = anchor.x + side * (GOOEY_MENU.reach + bow * bend)
    return side === 1 ? near : near - width
  })
  const shift =
    side === 1
      ? Math.min(0, viewport.width - pad - (Math.max(...lefts) + width))
      : Math.max(0, pad - Math.min(...lefts))
  return lefts.map((left, index) => ({
    left: left + shift,
    top: tops[index] ?? first,
    width,
  }))
}

/**
 * The pills of a menu opened at `origin` (M87, the owner's requests of
 * 2026-10-04: one blue pill per item, icon and label in it, all one size,
 * in a fan). They reach to the side of the origin with more room, away from
 * the nearer side edge, and centre on the origin unless that would leave
 * the panel.
 */
export function gooeyLayout(
  origin: MenuPoint,
  count: number,
  viewport: MenuViewport,
): GooeyPillLayout {
  const pad = GOOEY_MENU.edgePadding
  const point = {
    x: clamp(origin.x, pad, viewport.width - pad),
    y: clamp(origin.y, pad, viewport.height - pad),
  }
  const side: GooeySide = point.x < viewport.width / 2 ? 1 : -1
  return { origin: point, side, pills: column(point, side, count, viewport) }
}

/**
 * A group's second burst opens from its pill: the children centre on that
 * pill's height, on the same side of the menu's origin, and scale in from
 * the pill's centre. Undefined for an index with no pill.
 */
export function gooeySecondBurst(
  layout: GooeyPillLayout,
  index: number,
  count: number,
  viewport: MenuViewport,
): GooeyPillLayout | undefined {
  const pill = layout.pills[index]
  if (pill === undefined) {
    return undefined
  }
  const centre = { x: pill.left + pill.width / 2, y: pill.top + GOOEY_MENU.pillHeight / 2 }
  return {
    origin: centre,
    side: layout.side,
    pills: column({ x: layout.origin.x, y: centre.y }, layout.side, count, viewport),
  }
}
