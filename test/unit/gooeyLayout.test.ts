import { describe, expect, it } from 'vitest'
import { gooeyLayout, gooeySecondBurst } from '../../src/webview/gooeyLayout'

const viewport = { width: 320, height: 760 }

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
})
