import { describe, expect, it } from 'vitest'
import {
  gooeyLayout,
  gooeyPillMaxWidth,
  gooeySecondBurst,
  type GooeyPill,
} from '../../src/webview/gooeyLayout'

const narrow = { width: 320, height: 760 }
const wide = { width: 690, height: 760 }
const HEIGHT = 40

// Drawn widths from a short English label to a German or pseudo-locale one
// wider than any panel's room, which the layout caps at the panel's width.
const LONG = [96, 188, 262, 341, 410, 520]

const isOverlapping = (a: GooeyPill, b: GooeyPill) =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + HEIGHT &&
  b.top < a.top + HEIGHT

const expectInside = (
  pills: readonly GooeyPill[],
  viewport: { readonly width: number; readonly height: number },
) => {
  for (const pill of pills) {
    expect(pill.left).toBeGreaterThanOrEqual(8)
    expect(pill.top).toBeGreaterThanOrEqual(8)
    expect(pill.left + pill.width).toBeLessThanOrEqual(viewport.width - 8)
    expect(pill.top + HEIGHT).toBeLessThanOrEqual(viewport.height - 8)
  }
}

const expectApart = (pills: readonly GooeyPill[], where: string) => {
  for (const [index, pill] of pills.entries()) {
    const later = pills.slice(index + 1)
    for (const other of later) {
      expect(isOverlapping(pill, other), `${where}: pills overlap`).toBe(false)
    }
  }
}

describe('gooeyLayout (pills, 2026-10-04)', () => {
  it('stacks the pills 20 px apart, centred on the origin, on an arc that bows out', () => {
    const { origin, side, pills } = gooeyLayout({ x: 300, y: 380 }, [100, 120, 140], narrow)
    expect(origin).toEqual({ x: 300, y: 380 })
    expect(side).toBe(-1)
    expect(pills.map((pill) => pill.top)).toEqual([300, 360, 420])
    expect(pills.map((pill) => pill.width)).toEqual([100, 120, 140])
    // Near ends: 16 px plus up to 32 px of bow, the middle pill farthest out.
    const reach = pills.map((pill) => origin.x - (pill.left + pill.width))
    expect(reach[1]).toBeCloseTo(48)
    expect(reach[0]).toBeCloseTo(16 + 32 * Math.sqrt(5 / 9))
    expect(reach[2]).toBeCloseTo(reach[0] ?? 0)
  })

  it.each([
    [10, 380, 1],
    [159, 380, 1],
    [161, 380, -1],
    [312, 380, -1],
  ])('reaches away from the nearer side edge from x = %s', (x, y, side) => {
    const result = gooeyLayout({ x, y }, [80, 80, 80], narrow)
    expect(result.side).toBe(side)
    for (const pill of result.pills) {
      if (side === 1) {
        expect(pill.left).toBeGreaterThanOrEqual(result.origin.x + 16)
      } else {
        expect(pill.left + pill.width).toBeLessThanOrEqual(result.origin.x - 16)
      }
    }
  })

  it('opens down from a top corner and up from a bottom one, curving back to the origin', () => {
    const down = gooeyLayout({ x: 312, y: 20 }, [120, 120, 120, 120], narrow)
    expect(down.pills[0]?.top).toBe(8)
    const up = gooeyLayout({ x: 312, y: 750 }, [120, 120, 120, 120], narrow)
    expect((up.pills.at(-1)?.top ?? 0) + HEIGHT).toBe(752)
    const reachOf = ({ origin, pills }: typeof down) =>
      pills.map((pill) => origin.x - (pill.left + pill.width))
    // The pill level with the origin reaches farthest; the far end curves back.
    const downReach = reachOf(down)
    expect(downReach[0]).toBeGreaterThan(downReach.at(-1) ?? Infinity)
    const upReach = reachOf(up)
    expect(upReach.at(-1)).toBeGreaterThan(upReach[0] ?? Infinity)
  })

  it.each([2, 3, 4, 5, 6])(
    'keeps %s pills with long labels inside 320 and 690 px, apart',
    (count) => {
      for (const viewport of [narrow, wide]) {
        for (const x of [0, 40, 160, 250, viewport.width - 20, viewport.width]) {
          for (const y of [0, 40, 380, 700, viewport.height]) {
            const widths = LONG.slice(0, count)
            const { pills } = gooeyLayout({ x, y }, widths, viewport)
            expect(pills).toHaveLength(count)
            expectInside(pills, viewport)
            expectApart(pills, `${String(viewport.width)} px from (${String(x)}, ${String(y)})`)
            for (const [index, pill] of pills.entries()) {
              expect(pill.width).toBe(Math.min(widths[index] ?? 0, viewport.width - 16))
            }
          }
        }
      }
    },
  )

  it('caps a pill at the panel less its padding', () => {
    expect(gooeyPillMaxWidth(narrow)).toBe(304)
    expect(gooeyPillMaxWidth({ width: 10, height: 10 })).toBe(0)
    const { pills } = gooeyLayout({ x: 312, y: 380 }, [900], narrow)
    expect(pills[0]).toMatchObject({ left: 8, width: 304 })
  })

  it('shares out a short panel’s height, still inside and apart while the rows fit', () => {
    // Six 40 px rows in 280 px of room: 8 px gaps instead of 20.
    const short = { width: 320, height: 296 }
    const { pills } = gooeyLayout({ x: 312, y: 150 }, LONG, short)
    expect(pills.map((pill) => pill.top)).toEqual([8, 56, 104, 152, 200, 248])
    expectInside(pills, short)
    expectApart(pills, 'short panel')
  })

  it('opens a second burst from a group pill, on the same side, inside the panel', () => {
    const layout = gooeyLayout({ x: 312, y: 740 }, [140, 90, 210], narrow)
    const group = layout.pills[1]
    if (group === undefined) {
      throw new Error('missing group pill')
    }
    const burst = gooeySecondBurst(layout, 1, [230, 300, 180, 340], narrow)
    expect(burst?.origin).toEqual({ x: group.left + group.width / 2, y: group.top + HEIGHT / 2 })
    expect(burst?.side).toBe(layout.side)
    expect(burst?.pills).toHaveLength(4)
    expectInside(burst?.pills ?? [], narrow)
    expectApart(burst?.pills ?? [], 'second burst')
    // Centred on the group's own pill (top 240, middle 260), not the origin
    // (380), unless the panel's edge moves it, as at the foot above.
    const first = gooeySecondBurst(
      gooeyLayout({ x: 312, y: 380 }, [90, 90, 90, 90, 90], narrow),
      0,
      [100, 100, 100],
      narrow,
    )
    expect(first?.pills.map((pill) => pill.top)).toEqual([180, 240, 300])
    expect(gooeySecondBurst(layout, 3, [100], narrow)).toBeUndefined()
    expect(gooeyLayout({ x: 0, y: 0 }, [], narrow).pills).toEqual([])
  })
})
