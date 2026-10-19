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
Every pill's width (the owner, 2026-10-04: "they should be a uniform
size"; 2026-10-09: "only as long as the text in the longest text
button"): `natural`, the widest pill's own max-content width as the
browser laid it out, so no pill is wider than its longest label needs.
Only too little room beside the opener narrows every pill together;
a longer label ends in an ellipsis and keeps its full tooltip.
*/
export function gooeyPillWidth(available: number, natural: number): number {
  return Math.max(0, Math.min(natural, available))
}

/**
The pills beside `anchor`, one row each, centred on its height and moved
whole to stay inside the panel, with 6 px gaps. Their near ends sit on half an ellipse
16–32 px from the anchor: the pills level with it reach farthest, the outer ones
curve back, so the rows read as a fan. When the fan would leave the panel
it moves back whole, keeping its arc and clearance from the opener.
Only too little room beside the opener gives it narrower pills and
a shallower arc. Rows and the opener never overlap.
*/
function column(
  anchor: MenuPoint,
  side: GooeySide,
  count: number,
  viewport: MenuViewport,
  natural: number,
  spacing: number,
): readonly GooeyPill[] {
  if (count === 0) {
    return []
  }
  const pad = GOOEY_MENU.edgePadding
  const height = GOOEY_MENU.pillHeight
  // A panel too short for the resting gap shares out what room there is.
  const room = viewport.height - 2 * pad
  const gap = count > 1 ? Math.min(spacing, (room - count * height) / (count - 1)) : 0
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
  // Only the fan’s side is available: shifting a viewport-wide pill would
  // cover its opener. The same room bounds the arc’s whole-stack shift.
  const across = (side === 1 ? viewport.width - pad - anchor.x : anchor.x - pad) - GOOEY_MENU.reach
  const width = gooeyPillWidth(across, natural)
  const spread = Math.max(...curve) - Math.min(...curve)
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
The pills of a menu opened at `origin` (M87, the owner's requests of
2026-10-04: one blue pill per item, icon and label in it, all one size,
in a fan). They reach to the side of the origin with more room, away from
the nearer side edge, and centre on the origin unless that would leave
the panel.
*/
export function gooeyLayout(
  origin: MenuPoint,
  count: number,
  viewport: MenuViewport,
  natural: number,
  spacing: number = GOOEY_MENU.gap,
): GooeyPillLayout {
  const pad = GOOEY_MENU.edgePadding
  const point = {
    x: clamp(origin.x, pad, viewport.width - pad),
    y: clamp(origin.y, pad, viewport.height - pad),
  }
  const side: GooeySide = point.x < viewport.width / 2 ? 1 : -1
  return { origin: point, side, pills: column(point, side, count, viewport, natural, spacing) }
}

/**
A group's second burst opens from its pill: the children centre on that
pill's height, on the same side of the menu's origin, and scale in from
the pill's centre. Undefined for an index with no pill.
*/
export function gooeySecondBurst(
  layout: GooeyPillLayout,
  index: number,
  count: number,
  viewport: MenuViewport,
  natural: number,
  spacing: number = GOOEY_MENU.gap,
): GooeyPillLayout | undefined {
  const pill = layout.pills[index]
  if (pill === undefined) {
    return undefined
  }
  const centre = { x: pill.left + pill.width / 2, y: pill.top + GOOEY_MENU.pillHeight / 2 }
  return {
    origin: centre,
    side: layout.side,
    pills: column(
      { x: layout.origin.x, y: centre.y },
      layout.side,
      count,
      viewport,
      natural,
      spacing,
    ),
  }
}
