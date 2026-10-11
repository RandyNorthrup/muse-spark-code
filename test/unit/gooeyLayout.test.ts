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

const isOverlapping = (a: GooeyPill, b: GooeyPill, bHeight = HEIGHT) =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + bHeight &&
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
  it.each([1, 2, 3, 4, 5, 6])(
    'keeps both bursts clear of the opener at every 280–700 px width, with %s pills',
    (count) => {
      const failures: string[] = []
      for (let width = 280; width <= 700; width += 1) {
        const viewport = { width, height: 800 }
        for (const x of [24, width / 2, width - 24]) {
          for (const y of [68, 400, 732]) {
            const layout = gooeyLayout({ x, y }, count, viewport, 400)
            const opener = { left: x - 12, top: y - 12, width: 24 }
            for (const burst of [layout, gooeySecondBurst(layout, 0, count, viewport, 400)]) {
              if (burst === undefined) throw new Error('Missing menu burst')
              // Collect geometry violations without millions of assertion objects.
              // Every integer width, both bursts and each opener are still checked.
              const isMisplaced = burst.pills.some((pill, index) => {
                const near = burst.side === 1 ? pill.left - x : x - pill.left - pill.width
                return (
                  pill.left < 8 ||
                  pill.left + pill.width > width - 8 ||
                  pill.top < 8 ||
                  pill.top + HEIGHT > viewport.height - 8 ||
                  pill.width !== burst.pills[0]?.width ||
                  isOverlapping(pill, opener, 24) ||
                  near < 16 - 1e-10 ||
                  near > 32 + 1e-10 ||
                  burst.pills.slice(index + 1).some((other) => isOverlapping(pill, other))
                )
              })
              if (isMisplaced) failures.push(`${String(width)} px / (${String(x)}, ${String(y)})`)
            }
          }
        }
      }
      expect(failures).toEqual([])
    },
  )

  it.each([
    [320, 160, 100],
    [320, 296, 180],
    [690, 345, 100],
    [690, 666, 180],
  ])('keeps 2, 3 and 5 pills close at %s px, x=%s, width=%s', (width, x, natural) => {
    const viewport = { width, height: 800 }
    // Cover a button in the panel's centre and the row's usual right-edge opener.
    for (const count of [2, 3, 5]) {
      for (const y of [400, 40]) {
        const layout = gooeyLayout({ x, y }, count, viewport, natural)
        expectInside(layout.pills, viewport)
        expectApart(layout.pills, `${String(width)} px / ${String(count)} pills`)
        for (const [index, pill] of layout.pills.entries()) {
          const near = x - (pill.left + pill.width)
          expect(near).toBeGreaterThanOrEqual(16)
          expect(near).toBeLessThanOrEqual(32)
          const next = layout.pills[index + 1]
          if (next !== undefined) expect(next.top - pill.top - HEIGHT).toBe(6)
          // A 24 px button centred here stays clear of every pill.
          expect(pill.left + pill.width).toBeLessThanOrEqual(x - 12)
        }
        const first = layout.pills[0]
        const last = layout.pills.at(-1)
        if (first === undefined || last === undefined) throw new Error('Missing fan pills')
        if (y === 400) expect((first.top + last.top + HEIGHT) / 2).toBe(y)
        else {
          expect(first.top).toBeLessThanOrEqual(y)
          expect(first.top + HEIGHT).toBeGreaterThanOrEqual(y)
          expect(last.top + HEIGHT / 2 - y).toBeLessThanOrEqual(count * 46)
        }
      }
    }
  })

  it('gives every pill the widest label’s width, cut only by the available side room', () => {
    expect(gooeyPillWidth(288, 143)).toBe(143)
    expect(gooeyPillWidth(642, 400)).toBe(400)
    expect(gooeyPillWidth(288, 400)).toBe(288)
    expect(gooeyPillWidth(-6, 143)).toBe(0)
  })

  it('never widens a pill past its longest label: one width, the natural one', () => {
    for (const natural of [96, 143, 210]) {
      const { pills } = gooeyLayout({ x: 40, y: 380 }, 4, narrow, natural)
      expect(new Set(pills.map((pill) => pill.width))).toEqual(new Set([natural]))
      expectInside(pills, narrow)
      expectApart(pills, `natural ${String(natural)}`)
    }
  })

  it('stacks the pills 6 px apart, centred on the origin, on an arc that bows out', () => {
    const { origin, side, pills } = gooeyLayout({ x: 600, y: 380 }, 3, wide, WIDTH)
    expect(origin).toEqual({ x: 600, y: 380 })
    expect(side).toBe(-1)
    expect(pills.map((pill) => pill.top)).toEqual([314, 360, 406])
    expect(pills.map((pill) => pill.width)).toEqual([WIDTH, WIDTH, WIDTH])
    // Near ends: 16 px plus up to 16 px of bow, the middle pill farthest out.
    const reach = pills.map((pill) => origin.x - (pill.left + pill.width))
    expect(reach[1]).toBeCloseTo(32)
    expect(reach[0]).toBeCloseTo(16 + 16 * Math.sqrt(5 / 9))
    expect(reach[2]).toBeCloseTo(reach[0] ?? 0)
  })

  it.each([
    [10, 1],
    [344, 1],
    [346, -1],
    [682, -1],
  ])('reaches away from the nearer side edge from x = %s', (x, side) => {
    const result = gooeyLayout({ x, y: 380 }, 3, wide, WIDTH)
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
    'keeps the whole arc for %s pills when side room fits the labels and bow',
    (count) => {
      for (const y of [0, 40, 380, 700, 760]) {
        const shape = bows(gooeyLayout({ x: 600, y }, count, wide, 96))
        for (const x of [0, 40, 159, 161, 250, 300, 320]) {
          const layout = gooeyLayout({ x, y }, count, narrow, 96)
          const at = `(${String(x)}, ${String(y)})`
          expect(layout.pills).toHaveLength(count)
          expectInside(layout.pills, narrow)
          expectApart(layout.pills, at)
          for (const [index, bow] of bows(layout).entries()) {
            expect(bow, at).toBeCloseTo(shape[index] ?? NaN)
          }
          for (const pill of layout.pills) {
            expect(pill.width).toBe(96)
          }
        }
      }
    },
  )

  it('tightens the arc only in a panel too narrow for the whole fan', () => {
    const roomy = bows(gooeyLayout({ x: 312, y: 380 }, 3, { width: 320, height: 760 }, WIDTH))
    const tight = gooeyLayout({ x: 300, y: 380 }, 3, { width: 312, height: 760 }, WIDTH)
    expectInside(tight.pills, { width: 312, height: 760 })
    const tightBows = bows(tight)
    // Still a fan: the middle pill reaches farthest, by less than at 320 px.
    expect(tightBows[1]).toBeGreaterThan(0)
    expect(tightBows[1]).toBeLessThan(roomy[1] ?? 0)
    expect(tightBows[2]).toBeCloseTo(0)
    // A panel narrower than a pill plus padding: one straight column, inside.
    const column = gooeyLayout({ x: 180, y: 380 }, 4, { width: 200, height: 760 }, WIDTH)
    expectInside(column.pills, { width: 200, height: 760 })
    expect(new Set(column.pills.map((pill) => pill.left))).toEqual(new Set([8]))
    expectApart(column.pills, '200 px')
  })

  it('opens down from a top corner and up from a bottom one, curving back to the origin', () => {
    const down = gooeyLayout({ x: 680, y: 20 }, 4, wide, WIDTH)
    expect(down.pills[0]?.top).toBe(8)
    const up = gooeyLayout({ x: 680, y: 750 }, 4, wide, WIDTH)
    expect((up.pills.at(-1)?.top ?? 0) + HEIGHT).toBe(752)
    // The pill level with the origin reaches farthest; the far end curves back.
    const downBows = bows(down)
    expect(downBows.at(-1)).toBeLessThan(0)
    const upBows = bows(up)
    expect(upBows.at(-1)).toBeGreaterThan(0)
  })

  it('shares out a short panel’s height, still inside and apart while the rows fit', () => {
    // Six 40 px rows in 260 px of room: 4 px gaps instead of 6.
    const short = { width: 320, height: 276 }
    const { pills } = gooeyLayout({ x: 312, y: 150 }, 6, short, WIDTH)
    expect(pills.map((pill) => pill.top)).toEqual([8, 52, 96, 140, 184, 228])
    expectInside(pills, short)
    expectApart(pills, 'short panel')
  })

  it('opens a second burst from a group pill, on the same side, inside the panel', () => {
    const layout = gooeyLayout({ x: 312, y: 740 }, 3, narrow, WIDTH)
    const group = layout.pills[1]
    if (group === undefined) {
      throw new Error('missing group pill')
    }
    const burst = gooeySecondBurst(layout, 1, 4, narrow, WIDTH)
    expect(burst?.origin).toEqual({ x: group.left + group.width / 2, y: group.top + HEIGHT / 2 })
    expect(burst?.side).toBe(layout.side)
    expect(burst?.pills).toHaveLength(4)
    expectInside(burst?.pills ?? [], narrow)
    expectApart(burst?.pills ?? [], 'second burst')
    // Centred on the group's own pill (top 268, middle 288), not the origin
    // (380), unless the panel's edge moves it, as at the foot above.
    const first = gooeySecondBurst(
      gooeyLayout({ x: 312, y: 380 }, 5, narrow, WIDTH),
      0,
      3,
      narrow,
      WIDTH,
    )
    expect(first?.pills.map((pill) => pill.top)).toEqual([222, 268, 314])
    const firstPills = first?.pills ?? []
    for (const [index, pill] of firstPills.entries()) {
      const near = 312 - (pill.left + pill.width)
      expect(near).toBeGreaterThanOrEqual(16)
      expect(near).toBeLessThanOrEqual(32)
      const next = first?.pills[index + 1]
      if (next !== undefined) expect(next.top - pill.top - HEIGHT).toBe(6)
    }
    expect(gooeySecondBurst(layout, 3, 1, narrow, WIDTH)).toBeUndefined()
    expect(gooeyLayout({ x: 0, y: 0 }, 0, narrow, WIDTH).pills).toEqual([])
  })
})
