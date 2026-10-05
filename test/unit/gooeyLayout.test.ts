import { describe, expect, it } from 'vitest'
import {
  gooeyLayout,
  gooeyPillWidth,
  gooeySecondBurst,
  type GooeyPill,
  type GooeyPillLayout,
} from '../../src/webview/gooeyLayout'

const narrow = { width: 320, height: 760 }
const wide = { width: 690, height: 760 }
const HEIGHT = 40
const WIDTH = 272

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

/** How far each pill's near end reaches out from the first pill's: the arc's shape. */
const bows = ({ side, pills }: GooeyPillLayout) =>
  pills.map((pill) => side * (pill.left - (pills[0]?.left ?? 0)))

describe('gooeyLayout (a fan of uniform pills, 2026-10-04)', () => {
  it('gives every pill one width: the widest that keeps the whole fan in 320 px', () => {
    expect(gooeyPillWidth(narrow)).toBe(WIDTH)
    expect(gooeyPillWidth(wide)).toBe(WIDTH)
    expect(gooeyPillWidth({ width: 200, height: 760 })).toBe(184)
    expect(gooeyPillWidth({ width: 10, height: 10 })).toBe(0)
  })

  it('stacks the pills 20 px apart, centred on the origin, on an arc that bows out', () => {
    const { origin, side, pills } = gooeyLayout({ x: 600, y: 380 }, 3, wide)
    expect(origin).toEqual({ x: 600, y: 380 })
    expect(side).toBe(-1)
    expect(pills.map((pill) => pill.top)).toEqual([300, 360, 420])
    expect(pills.map((pill) => pill.width)).toEqual([WIDTH, WIDTH, WIDTH])
    // Near ends: 16 px plus up to 32 px of bow, the middle pill farthest out.
    const reach = pills.map((pill) => origin.x - (pill.left + pill.width))
    expect(reach[1]).toBeCloseTo(48)
    expect(reach[0]).toBeCloseTo(16 + 32 * Math.sqrt(5 / 9))
    expect(reach[2]).toBeCloseTo(reach[0] ?? 0)
  })

  it.each([
    [10, 1],
    [344, 1],
    [346, -1],
    [682, -1],
  ])('reaches away from the nearer side edge from x = %s', (x, side) => {
    const result = gooeyLayout({ x, y: 380 }, 3, wide)
    expect(result.side).toBe(side)
    for (const pill of result.pills) {
      if (side === 1) {
        expect(pill.left).toBeGreaterThanOrEqual(result.origin.x + 16)
      } else {
        expect(pill.left + pill.width).toBeLessThanOrEqual(result.origin.x - 16)
      }
    }
  })

  it.each([2, 3, 4, 5, 6])(
    'keeps the whole arc for %s pills at 320 px, from any origin, moving it back whole',
    (count) => {
      for (const y of [0, 40, 380, 700, 760]) {
        const shape = bows(gooeyLayout({ x: 600, y }, count, wide))
        for (const x of [0, 40, 159, 161, 250, 300, 320]) {
          const layout = gooeyLayout({ x, y }, count, narrow)
          const at = `(${String(x)}, ${String(y)})`
          expect(layout.pills).toHaveLength(count)
          expectInside(layout.pills, narrow)
          expectApart(layout.pills, at)
          for (const [index, bow] of bows(layout).entries()) {
            expect(bow, at).toBeCloseTo(shape[index] ?? NaN)
          }
          for (const pill of layout.pills) {
            expect(pill.width).toBe(WIDTH)
          }
        }
      }
    },
  )

  it('tightens the arc only in a panel too narrow for the whole fan', () => {
    const roomy = bows(gooeyLayout({ x: 280, y: 380 }, 3, { width: 320, height: 760 }))
    const tight = gooeyLayout({ x: 280, y: 380 }, 3, { width: 290, height: 760 })
    expectInside(tight.pills, { width: 290, height: 760 })
    const tightBows = bows(tight)
    // Still a fan: the middle pill reaches farthest, by less than at 320 px.
    expect(tightBows[1]).toBeGreaterThan(0)
    expect(tightBows[1]).toBeLessThan(roomy[1] ?? 0)
    expect(tightBows[2]).toBeCloseTo(0)
    // A panel narrower than a pill plus padding: one straight column, inside.
    const column = gooeyLayout({ x: 180, y: 380 }, 4, { width: 200, height: 760 })
    expectInside(column.pills, { width: 200, height: 760 })
    expect(new Set(column.pills.map((pill) => pill.left))).toEqual(new Set([8]))
    expectApart(column.pills, '200 px')
  })

  it('opens down from a top corner and up from a bottom one, curving back to the origin', () => {
    const down = gooeyLayout({ x: 680, y: 20 }, 4, wide)
    expect(down.pills[0]?.top).toBe(8)
    const up = gooeyLayout({ x: 680, y: 750 }, 4, wide)
    expect((up.pills.at(-1)?.top ?? 0) + HEIGHT).toBe(752)
    // The pill level with the origin reaches farthest; the far end curves back.
    const downBows = bows(down)
    expect(downBows.at(-1)).toBeLessThan(0)
    const upBows = bows(up)
    expect(upBows.at(-1)).toBeGreaterThan(0)
  })

  it('shares out a short panel’s height, still inside and apart while the rows fit', () => {
    // Six 40 px rows in 280 px of room: 8 px gaps instead of 20.
    const short = { width: 320, height: 296 }
    const { pills } = gooeyLayout({ x: 312, y: 150 }, 6, short)
    expect(pills.map((pill) => pill.top)).toEqual([8, 56, 104, 152, 200, 248])
    expectInside(pills, short)
    expectApart(pills, 'short panel')
  })

  it('opens a second burst from a group pill, on the same side, inside the panel', () => {
    const layout = gooeyLayout({ x: 312, y: 740 }, 3, narrow)
    const group = layout.pills[1]
    if (group === undefined) {
      throw new Error('missing group pill')
    }
    const burst = gooeySecondBurst(layout, 1, 4, narrow)
    expect(burst?.origin).toEqual({ x: group.left + group.width / 2, y: group.top + HEIGHT / 2 })
    expect(burst?.side).toBe(layout.side)
    expect(burst?.pills).toHaveLength(4)
    expectInside(burst?.pills ?? [], narrow)
    expectApart(burst?.pills ?? [], 'second burst')
    // Centred on the group's own pill (top 240, middle 260), not the origin
    // (380), unless the panel's edge moves it, as at the foot above.
    const first = gooeySecondBurst(gooeyLayout({ x: 312, y: 380 }, 5, narrow), 0, 3, narrow)
    expect(first?.pills.map((pill) => pill.top)).toEqual([180, 240, 300])
    expect(gooeySecondBurst(layout, 3, 1, narrow)).toBeUndefined()
    expect(gooeyLayout({ x: 0, y: 0 }, 0, narrow).pills).toEqual([])
  })
})
