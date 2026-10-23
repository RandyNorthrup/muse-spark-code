// RLF-DEVICES: D83.3's analysis and D83.6's limits. Bounds come from
// exact tracking (linear segments, arc extrema, homing, units and
// modes); geometry the analyser cannot bound refuses instead of
// understating; limits are the smaller of the machine's and the
// person's, field by field.
import { describe, expect, it } from 'vitest'
import {
  analyzeMakerPayload,
  checkMakerLimits,
  type MakerPosition,
} from '../../src/core/maker/analysis'

const ORIGIN: MakerPosition = { x: 0, y: 0, z: 0 }

function analysed(text: string, start: MakerPosition = ORIGIN) {
  const outcome = analyzeMakerPayload('printer', new TextEncoder().encode(text), start)
  expect(outcome.ok).toBe(true)
  if (!outcome.ok) throw new Error('expected analysis')
  return outcome
}

describe('maker analysis', () => {
  it('bounds absolute and relative moves', () => {
    const absolute = analysed('G1 X10 Y-5 Z2\n')
    expect(absolute.analysis.bounds).toEqual({
      min: { x: 0, y: -5, z: 0 },
      max: { x: 10, y: 0, z: 2 },
    })
    expect(absolute.motion).toEqual({ hasMotion: true, homingOnly: false })
    const relative = analysed('G91\nG1 X10 Y-5\n', { x: 100, y: 100, z: 0 })
    expect(relative.analysis.bounds).toEqual({
      min: { x: 100, y: 95, z: 0 },
      max: { x: 110, y: 100, z: 0 },
    })
  })

  it('converts inches to millimetres', () => {
    const outcome = analysed('G20\nG1 X1 F60\n')
    expect(outcome.analysis.bounds?.max.x).toBeCloseTo(25.4, 9)
    expect(outcome.analysis.maxFeedMmMin).toBeCloseTo(1524, 9)
  })

  it('bounds the arc bulge past its endpoints', () => {
    // Clockwise half circle from (0,0) to (10,0) about (5,0): the top
    // of the arc reaches y=5 while both endpoints sit at y=0.
    const arc = analysed('G2 X10 Y0 I5 J0\n')
    expect(arc.analysis.bounds?.min).toEqual({ x: 0, y: 0, z: 0 })
    expect(arc.analysis.bounds?.max.x).toBeCloseTo(10, 9)
    expect(arc.analysis.bounds?.max.y).toBeCloseTo(5, 9)
    // Counter-clockwise quarter from (10,0) to (0,10) about the origin.
    const quarter = analysed('G3 X0 Y10 I-10 J0\n', { x: 10, y: 0, z: 0 })
    expect(quarter.analysis.bounds).toEqual({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 10, y: 10, z: 0 },
    })
  })

  it('bounds R-form arcs and refuses the unboundable', () => {
    // R5 semicircle clockwise: same top half as the I-form case above.
    const semi = analysed('G2 X10 Y0 R5\n')
    expect(semi.analysis.bounds?.max.y).toBeCloseTo(5, 9)
    // R10 minor counter-clockwise: the arc dips below the chord.
    const minor = analysed('G3 X10 Y0 R10\n')
    expect(minor.analysis.bounds?.min.y ?? 0).toBeLessThan(0)
    expect(minor.analysis.bounds?.max.y).toBe(0)
    // A chord longer than the diameter has no arc at all.
    expect(
      analyzeMakerPayload('printer', new TextEncoder().encode('G2 X10 Y0 R4\n'), ORIGIN),
    ).toEqual({
      ok: false,
      command: 'G2',
    })
    // A full circle in R form has no defined center.
    expect(analyzeMakerPayload('printer', new TextEncoder().encode('G2 R5\n'), ORIGIN)).toEqual({
      ok: false,
      command: 'G2',
    })
    // An arc with no center at all refuses too.
    expect(analyzeMakerPayload('printer', new TextEncoder().encode('G3 X1 Y1\n'), ORIGIN)).toEqual({
      ok: false,
      command: 'G3',
    })
  })

  it('homes to zero and marks homing-only motion', () => {
    const home = analysed('G28\n', { x: 50, y: 60, z: 7 })
    expect(home.analysis.bounds).toEqual({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 50, y: 60, z: 7 },
    })
    expect(home.motion).toEqual({ hasMotion: true, homingOnly: true })
    const partial = analysed('G28 X\n', { x: 50, y: 60, z: 7 })
    expect(partial.analysis.bounds).toEqual({
      min: { x: 0, y: 60, z: 7 },
      max: { x: 50, y: 60, z: 7 },
    })
    const mixed = analysed('G28\nG1 X1\n')
    expect(mixed.motion).toEqual({ hasMotion: true, homingOnly: false })
  })

  it('tracks temperatures, feeds and unknown commands', () => {
    const outcome = analysed('M104 S200\nM140 S60\nG1 X1 F1500\nFOO_BAR Q1\n')
    expect(outcome.analysis.maxTempC).toBe(200)
    expect(outcome.analysis.maxFeedMmMin).toBe(1500)
    expect(outcome.analysis.unknownCommands).toEqual(['FOO_BAR'])
  })

  it('omits bounds, temps and feeds the payload never touches', () => {
    const outcome = analysed('M106 S128\n')
    expect(outcome.analysis.bounds).toBeUndefined()
    expect(outcome.analysis.maxTempC).toBeUndefined()
    expect(outcome.analysis.maxFeedMmMin).toBeUndefined()
    expect(outcome.motion.hasMotion).toBe(false)
  })
})

describe('maker limits', () => {
  it('enforces the smaller of the machine and the person, field by field', () => {
    const outcome = analysed('G1 X10 Y10\n')
    const check = (user?: { travelMm?: { max?: { x?: number } } }) =>
      checkMakerLimits({
        analysis: outcome.analysis,
        motion: outcome.motion,
        machine: { travelMm: { min: { x: 0, y: 0, z: 0 }, max: { x: 200, y: 200, z: 200 } } },
        ...(user !== undefined && { user }),
        homed: true,
        softLimits: true,
      })
    expect(check().ok).toBe(true)
    // The person's tighter ceiling wins over the machine's roomier one.
    const refused = check({ travelMm: { max: { x: 5 } } })
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.reason).toBe('outside-limits')
    expect(refused.detail).toContain('x')
  })

  it('refuses heat and feed past either ceiling', () => {
    const hot = analysed('M104 S300\n')
    const verdict = checkMakerLimits({
      analysis: hot.analysis,
      motion: hot.motion,
      machine: { maxTempC: 260 },
      homed: true,
      softLimits: true,
    })
    expect(verdict).toMatchObject({ ok: false, reason: 'outside-limits' })
  })

  it('refuses motion on an unhomed machine but allows homing', () => {
    const move = analysed('G1 X1\n')
    expect(
      checkMakerLimits({
        analysis: move.analysis,
        motion: move.motion,
        machine: { travelMm: { max: { x: 200, y: 200, z: 200 } } },
        homed: false,
        softLimits: true,
      }),
    ).toMatchObject({ ok: false, reason: 'unhomed' })
    const home = analysed('G28\n')
    expect(
      checkMakerLimits({
        analysis: home.analysis,
        motion: home.motion,
        machine: { travelMm: { max: { x: 200, y: 200, z: 200 } } },
        homed: false,
        softLimits: true,
      }).ok,
    ).toBe(true)
  })

  it('refuses sends with no limits at all', () => {
    const move = analysed('G1 X1\n')
    expect(
      checkMakerLimits({
        analysis: move.analysis,
        motion: move.motion,
        machine: {},
        homed: true,
        softLimits: true,
      }),
    ).toMatchObject({ ok: false, reason: 'no-limits' })
  })
})
