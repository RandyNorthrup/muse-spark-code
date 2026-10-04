import { GOOEY_MENU } from '../shared/constants'

export interface MenuPoint {
  readonly x: number
  readonly y: number
}

interface MenuViewport {
  readonly width: number
  readonly height: number
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
  const points = Array.from({ length: count }, (_, index) => {
    const angle = direction - (count > 1 ? sweep / 2 : 0) + index * step
    return { x: x + radius * Math.cos(angle), y: y + radius * Math.sin(angle) }
  })
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
  }
}

/** A group's bubble becomes the origin of its second burst. */
export function gooeySecondBurst(bubble: MenuPoint, count: number, viewport: MenuViewport) {
  return gooeyLayout(bubble, count, viewport)
}
