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

/** A pill's top-left corner and drawn width; every pill is `GOOEY_MENU.pillHeight` high. */
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

/** The widest a pill is drawn: the panel less the edge padding on both sides. */
export function gooeyPillMaxWidth(viewport: MenuViewport): number {
  return Math.max(0, viewport.width - 2 * GOOEY_MENU.edgePadding)
}

/**
 * One column of pills beside `anchor`, centred on its height and moved
 * whole to stay inside the panel. Rows never overlap, whatever the labels'
 * widths, so only the horizontal place depends on them. The near ends sit on
 * half an ellipse around the anchor: the pills level with it reach farthest,
 * the outer ones curve back, so the column reads as a fan.
 */
function column(
  anchor: MenuPoint,
  side: GooeySide,
  widths: readonly number[],
  viewport: MenuViewport,
): readonly GooeyPill[] {
  const count = widths.length
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
  const tops = widths.map((_, index) => first + index * step)
  // How far each pill's middle sits above or below the anchor, against half
  // a step past the outermost pill, so even that one curves out a little.
  const lifts = tops.map((top) => top + height / 2 - anchor.y)
  const span = Math.max(...lifts.map((lift) => Math.abs(lift))) + step / 2
  const maxWidth = gooeyPillMaxWidth(viewport)
  return widths.map((requested, index) => {
    const width = Math.min(requested, maxWidth)
    const lift = (lifts[index] ?? 0) / span
    const reach = GOOEY_MENU.reach + GOOEY_MENU.bow * Math.sqrt(1 - lift * lift)
    const near = anchor.x + side * reach
    return {
      // A pill too wide for its side of the origin slides back over it,
      // still whole inside the panel.
      left: clamp(side === 1 ? near : near - width, pad, viewport.width - pad - width),
      top: tops[index] ?? first,
      width,
    }
  })
}

/**
 * The pills of a menu opened at `origin` (M87, the owner's request of
 * 2026-10-04: labels on the bubbles, so pills). They stack in a column on
 * the side of the origin with more room, away from the nearer side edge,
 * and the column centres on the origin unless that would leave the panel.
 */
export function gooeyLayout(
  origin: MenuPoint,
  widths: readonly number[],
  viewport: MenuViewport,
): GooeyPillLayout {
  const pad = GOOEY_MENU.edgePadding
  const point = {
    x: clamp(origin.x, pad, viewport.width - pad),
    y: clamp(origin.y, pad, viewport.height - pad),
  }
  const side: GooeySide = point.x < viewport.width / 2 ? 1 : -1
  return { origin: point, side, pills: column(point, side, widths, viewport) }
}

/**
 * A group's second burst opens from its pill: the children centre on that
 * pill's height, on the same side of the menu's origin, and scale in from
 * the pill's centre. Undefined for an index with no pill.
 */
export function gooeySecondBurst(
  layout: GooeyPillLayout,
  index: number,
  widths: readonly number[],
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
    pills: column({ x: layout.origin.x, y: centre.y }, layout.side, widths, viewport),
  }
}
