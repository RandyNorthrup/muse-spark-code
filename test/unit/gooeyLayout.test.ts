import { describe, expect, it } from 'vitest'
import { gooeyLabelBox, gooeyLayout, gooeySecondBurst } from '../../src/webview/gooeyLayout'

const viewport = { width: 320, height: 760 }

// A label at the stylesheet's bound, min(180 px, 50vw - 40 px), on one line and on two.
const labelSizes = (box: { readonly width: number }) => [
  { width: Math.min(180, box.width / 2 - 40), height: 27 },
  { width: Math.min(180, box.width / 2 - 40), height: 46 },
]
const isOverBubble = (
  label: { readonly left: number; readonly top: number },
  size: { readonly width: number; readonly height: number },
  point: { readonly x: number; readonly y: number },
) =>
  label.left < point.x + 20 &&
  point.x - 20 < label.left + size.width &&
  label.top < point.y + 20 &&
  point.y - 20 < label.top + size.height

describe('gooeyLayout', () => {
  it('places equally spaced centres on an arc', () => {
    const { points, origin } = gooeyLayout({ x: 160, y: 380 }, 3, viewport)
    const distances = points.map((point) => Math.hypot(point.x - origin.x, point.y - origin.y))
    expect(distances[0]).toBeCloseTo(76)
    expect(distances[1]).toBeCloseTo(76)
    expect(distances[2]).toBeCloseTo(76)
    expect(points[0]?.x).toBeCloseTo(160)
    expect(points[1]?.x).toBeCloseTo(84)
    expect(points[2]?.x).toBeCloseTo(160)
    expect(points[0]?.y).toBeCloseTo(456)
    expect(points[2]?.y).toBeCloseTo(304)
  })

  it.each([
    [0, 380, 1, 0],
    [320, 380, -1, 0],
    [160, 0, 0, 1],
    [160, 760, 0, -1],
    [0, 0, 1, 1],
    [320, 0, -1, 1],
    [0, 760, 1, -1],
    [320, 760, -1, -1],
  ])('fans inward at edge/corner (%s,%s)', (x, y, dx, dy) => {
    const result = gooeyLayout({ x, y }, 3, viewport)
    expect(Math.cos(result.direction)).toBeCloseTo(dx === 0 ? 0 : dx / Math.hypot(dx, dy))
    expect(Math.sin(result.direction)).toBeCloseTo(dy === 0 ? 0 : dy / Math.hypot(dx, dy))
  })

  it.each([1, 3, 4, 6])('keeps all %s bubbles inside 320 px, without overlap', (count) => {
    for (const x of [0, 70, 160, 250, 320]) {
      for (const y of [0, 70, 380, 690, 760]) {
        const { points } = gooeyLayout({ x, y }, count, viewport)
        for (const [index, point] of points.entries()) {
          expect(point.x).toBeGreaterThanOrEqual(28)
          expect(point.x).toBeLessThanOrEqual(292)
          expect(point.y).toBeGreaterThanOrEqual(28)
          expect(point.y).toBeLessThanOrEqual(732)
          const next = points[index + 1]
          if (next !== undefined) {
            expect(Math.hypot(point.x - next.x, point.y - next.y)).toBeGreaterThanOrEqual(51.99)
          }
        }
      }
    }
  })

  it('opens a second inward burst from a group bubble', () => {
    const { points } = gooeyLayout({ x: 319, y: 759 }, 3, viewport)
    const bubble = points[1]
    expect(bubble).toBeDefined()
    if (bubble === undefined) {
      throw new Error('missing bubble')
    }
    const burst = gooeySecondBurst(bubble, 4, viewport)
    expect(burst.origin).toEqual(bubble)
    expect(burst.points).toHaveLength(4)
    for (const point of burst.points) {
      expect(point.x).toBeGreaterThanOrEqual(28)
      expect(point.x).toBeLessThanOrEqual(292)
      expect(point.y).toBeGreaterThanOrEqual(28)
      expect(point.y).toBeLessThanOrEqual(732)
    }
    expect(gooeyLayout({ x: 0, y: 0 }, 0, viewport).points).toEqual([])
  })

  // Lane W: a label hangs past its bubble on the side away from the fan's centre.
  it('puts each label past its bubble, away from the centre', () => {
    const wide = { width: 690, height: 760 }
    const size = { width: 60, height: 27 }
    // From the right edge the fan opens left: down, left and up of the centre.
    const layout = gooeyLayout({ x: 682, y: 380 }, 3, wide)
    expect(gooeyLabelBox(layout, 0, size, wide)).toEqual({ left: 574, top: 488 })
    const beside = gooeyLabelBox(layout, 1, size, wide)
    expect(beside?.left).toBeCloseTo(498)
    expect(beside?.top).toBeCloseTo(366.5)
    expect(gooeyLabelBox(layout, 2, size, wide)).toEqual({ left: 574, top: 245 })
    expect(gooeyLabelBox(layout, 3, size, wide)).toBeUndefined()
  })

  it('turns a label that would leave the panel to another side', () => {
    const wide = { width: 690, height: 760 }
    const size = { width: 180, height: 46 }
    // Two bubbles level with a centre at the top edge: outward is off the panel.
    const layout = gooeyLayout({ x: 586, y: 56 }, 2, wide)
    for (const index of [0, 1]) {
      const box = gooeyLabelBox(layout, index, size, wide)
      expect(box).toBeDefined()
      expect(box?.left).toBeGreaterThanOrEqual(0)
      expect((box?.left ?? 0) + size.width).toBeLessThanOrEqual(wide.width)
    }
  })

  it.each([2, 3, 4, 5, 6])(
    'keeps every label of %s bubbles inside the panel and off its own bubble',
    (count) => {
      for (const box of [viewport, { width: 690, height: 760 }]) {
        for (const size of labelSizes(box)) {
          for (const x of [0, 70, 160, 250, box.width - 70, box.width]) {
            for (const y of [0, 70, 380, 690, box.height]) {
              const layout = gooeyLayout({ x, y }, count, box)
              for (const [index, point] of layout.points.entries()) {
                const label = gooeyLabelBox(layout, index, size, box)
                if (label === undefined) {
                  throw new Error('no label box')
                }
                expect(label.left).toBeGreaterThanOrEqual(0)
                expect(label.top).toBeGreaterThanOrEqual(0)
                expect(label.left + size.width).toBeLessThanOrEqual(box.width)
                expect(label.top + size.height).toBeLessThanOrEqual(box.height)
                expect(isOverBubble(label, size, point)).toBe(false)
              }
            }
          }
        }
      }
    },
  )

  // A row's ⋯ sits at the right edge, and a pointer near either side fans
  // inward: there every label clears every bubble.
  it.each([2, 3, 4, 5, 6])(
    'keeps every label of %s bubbles off the others from a side',
    (count) => {
      for (const box of [viewport, { width: 690, height: 760 }]) {
        for (const size of labelSizes(box)) {
          for (const x of [0, 70, box.width - 70, box.width]) {
            for (const y of [0, 70, 380, 690, box.height]) {
              const layout = gooeyLayout({ x, y }, count, box)
              for (const index of layout.points.keys()) {
                const label = gooeyLabelBox(layout, index, size, box)
                for (const [other, point] of layout.points.entries()) {
                  expect(
                    label !== undefined && isOverBubble(label, size, point),
                    `label ${String(index)} over bubble ${String(other)} from (${String(x)}, ${String(y)})`,
                  ).toBe(false)
                }
              }
            }
          }
        }
      }
    },
  )
})
