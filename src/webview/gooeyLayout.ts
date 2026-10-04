import { GOOEY_MENU } from '../shared/constants'

export interface MenuPoint {
  readonly x: number
  readonly y: number
}

interface MenuViewport {
  readonly width: number
  readonly height: number
}

/** A label's measured size, and the top-left corner it is drawn at. */
export interface GooeyLabelSize {
  readonly width: number
  readonly height: number
}

export interface GooeyLabelBox {
  readonly left: number
  readonly top: number
}

/** -1, 0 or 1 on each axis: before, centred on or after the bubble. */
type Side = -1 | 0 | 1
const FLIPPED: Readonly<Record<Side, Side>> = { [-1]: 1, 0: 0, 1: -1 }

function boxAt(point: MenuPoint, size: GooeyLabelSize, across: Side, down: Side): GooeyLabelBox {
  const half = GOOEY_MENU.bubbleSize / 2
  const sides: Record<Side, number> = {
    [-1]: point.x - half - GOOEY_MENU.labelSide - size.width,
    0: point.x - size.width / 2,
    1: point.x + half + GOOEY_MENU.labelSide,
  }
  const rows: Record<Side, number> = {
    [-1]: point.y - half - GOOEY_MENU.gap - size.height,
    0: point.y - size.height / 2,
    1: point.y + half + GOOEY_MENU.gap,
  }
  return { left: sides[across], top: rows[down] }
}

function isInside(box: GooeyLabelBox, size: GooeyLabelSize, viewport: MenuViewport): boolean {
  return (
    box.left >= 0 &&
    box.top >= 0 &&
    box.left + size.width <= viewport.width &&
    box.top + size.height <= viewport.height
  )
}

function isOnBubble(box: GooeyLabelBox, size: GooeyLabelSize, point: MenuPoint): boolean {
  const half = GOOEY_MENU.bubbleSize / 2
  return (
    box.left < point.x + half &&
    point.x - half < box.left + size.width &&
    box.top < point.y + half &&
    point.y - half < box.top + size.height
  )
}

function overlapArea(box: GooeyLabelBox, size: GooeyLabelSize, point: MenuPoint): number {
  const half = GOOEY_MENU.bubbleSize / 2
  const width = Math.min(box.left + size.width, point.x + half) - Math.max(box.left, point.x - half)
  const height = Math.min(box.top + size.height, point.y + half) - Math.max(box.top, point.y - half)
  return Math.max(0, width) * Math.max(0, height)
}

/**
 * Where a bubble's label goes (M87, lane W), once its size is measured. The
 * first choice is past the bubble on the side away from the fan's centre:
 * beside it for a bubble level with the centre, past its outer corner for one
 * above or below (straight above or below, leaning to the panel's middle).
 * Then the other side; then above or below it, slid along the row to clear
 * the neighbours; then the remaining corners. The first that stays inside
 * the panel and off every bubble wins; with none, the one inside the panel
 * and off its own bubble that covers the least of the others. Lane W's
 * settled-position check found the earlier viewport-half rule putting the
 * third bubble's label on the second.
 */
export function gooeyLabelBox(
  layout: { readonly points: readonly MenuPoint[]; readonly offsets: readonly MenuPoint[] },
  index: number,
  size: GooeyLabelSize,
  viewport: MenuViewport,
): GooeyLabelBox | undefined {
  const point = layout.points[index]
  const offset = layout.offsets[index]
  if (point === undefined || offset === undefined) {
    return undefined
  }
  const half = GOOEY_MENU.bubbleSize / 2
  const lean: Side = point.x <= viewport.width / 2 ? 1 : -1
  const across: Side = Math.abs(offset.x) > half ? (offset.x > 0 ? 1 : -1) : lean
  const down: Side = Math.abs(offset.y) > half ? (offset.y > 0 ? 1 : -1) : 0
  const flip = (side: Side): Side => FLIPPED[side]
  const isClear = (box: GooeyLabelBox) =>
    isInside(box, size, viewport) && layout.points.every((other) => !isOnBubble(box, size, other))
  // Above or below the bubble, slid along its row to clear the neighbours
  // while still over the bubble: the nearest to centred that fits.
  const slid = (row: Side): GooeyLabelBox | undefined => {
    const { top } = boxAt(point, size, 0, row)
    const centred = point.x - size.width / 2
    const lefts = [
      centred,
      ...layout.points.flatMap((other) => [
        other.x + half + GOOEY_MENU.labelSide,
        other.x - half - GOOEY_MENU.labelSide - size.width,
      ]),
    ].map((left) => Math.max(0, Math.min(viewport.width - size.width, left)))
    return lefts
      .filter((left) => left < point.x + half && point.x - half < left + size.width)
      .map((left) => ({ left, top }))
      .filter((box) => isClear(box))
      .toSorted((a, b) => Math.abs(a.left - centred) - Math.abs(b.left - centred))[0]
  }
  const rows: readonly Side[] = down === 0 ? [1, -1] : [down, flip(down)]
  const candidates: (() => GooeyLabelBox | undefined)[] = [
    () => boxAt(point, size, across, down),
    () => boxAt(point, size, flip(across), down),
    ...rows.map((row) => () => slid(row)),
    ...rows.flatMap((row) => [
      () => boxAt(point, size, across, row),
      () => boxAt(point, size, flip(across), row),
    ]),
  ]
  const boxes = candidates
    .map((candidate) => candidate())
    .filter((box): box is GooeyLabelBox => box !== undefined)
  const clear = boxes.find((box) => isClear(box))
  if (clear !== undefined) {
    return clear
  }
  // No room clear of every bubble (a long label in a corner of a narrow
  // panel): inside the panel and off its own bubble, over as little of the
  // others as can be.
  const covered = (box: GooeyLabelBox) =>
    layout.points.reduce((sum, other) => sum + overlapArea(box, size, other), 0)
  const fallback = boxes
    .filter((box) => isInside(box, size, viewport) && !isOnBubble(box, size, point))
    .toSorted((a, b) => covered(a) - covered(b))[0]
  if (fallback !== undefined) {
    return fallback
  }
  const first = boxAt(point, size, across, down)
  return {
    left: Math.max(0, Math.min(viewport.width - size.width, first.left)),
    top: Math.max(0, Math.min(viewport.height - size.height, first.top)),
  }
}

/** Centres on an inward-facing arc; translating the whole fan preserves its spacing. */
export function gooeyLayout(origin: MenuPoint, count: number, viewport: MenuViewport) {
  const inset = GOOEY_MENU.bubbleSize / 2 + GOOEY_MENU.edgePadding
  const x = Math.max(inset, Math.min(viewport.width - inset, origin.x))
  const y = Math.max(inset, Math.min(viewport.height - inset, origin.y))
  const horizontal = Math.min(x, viewport.width - x)
  const vertical = Math.min(y, viewport.height - y)
  const isNearX = horizontal < GOOEY_MENU.radius + inset
  const isNearY = vertical < GOOEY_MENU.radius + inset
  const dx = x < viewport.width / 2 ? 1 : -1
  const dy = y < viewport.height / 2 ? 1 : -1
  let direction: number
  if (isNearX && isNearY) {
    direction = Math.atan2(dy, dx)
  } else if (horizontal < vertical) {
    direction = Math.atan2(0, dx)
  } else {
    direction = Math.atan2(dy, 0)
  }
  const sweep = isNearX && isNearY ? Math.PI / 2 : Math.PI
  const step = count > 1 ? sweep / (count - 1) : 0
  const radius = Math.max(
    GOOEY_MENU.radius,
    count > 1 ? (GOOEY_MENU.bubbleSize + GOOEY_MENU.gap) / (2 * Math.sin(step / 2)) : 0,
  )
  const offsets = Array.from({ length: count }, (_, index) => {
    const angle = direction - (count > 1 ? sweep / 2 : 0) + index * step
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }
  })
  const points = offsets.map((offset) => ({ x: x + offset.x, y: y + offset.y }))
  const shift = (values: readonly number[], extent: number) => {
    const low = Math.min(...values)
    const high = Math.max(...values)
    return Math.max(inset - low, Math.min(0, extent - inset - high))
  }
  const shiftX =
    points.length === 0
      ? 0
      : shift(
          points.map((point) => point.x),
          viewport.width,
        )
  const shiftY =
    points.length === 0
      ? 0
      : shift(
          points.map((point) => point.y),
          viewport.height,
        )
  return {
    origin: { x, y },
    direction,
    points: points.map((point) => ({ x: point.x + shiftX, y: point.y + shiftY })),
    // Each bubble's way out from the fan's centre, for its label (gooeyLabelBox).
    offsets,
  }
}

/** A group's bubble becomes the origin of its second burst. */
export function gooeySecondBurst(bubble: MenuPoint, count: number, viewport: MenuViewport) {
  return gooeyLayout(bubble, count, viewport)
}
