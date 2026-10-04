import { describe, expect, it } from 'vitest'
import { HEARTBEAT_BEAM_STEP_PX } from '../../src/shared/constants'
import { beamY, stepBeam, TRACE_BASELINE_Y, TRACE_WIDTH } from '../../src/webview/heartbeatBeam'

describe('heartbeatBeam beamY (M87)', () => {
  it('rests on the baseline outside the P/QRS/T regions', () => {
    for (const x of [0, 5, 10, 17.9, 30, 33.9, 54, 60, 62.9, 74, 85, 100]) {
      expect(beamY(x)).toBe(TRACE_BASELINE_Y)
    }
  })

  it('draws the small P bump between x 18 and 29', () => {
    expect(beamY(18)).toBe(TRACE_BASELINE_Y)
    expect(beamY(24)).toBe(9)
    expect(beamY(29)).toBe(TRACE_BASELINE_Y)
    for (const x of [19, 21, 24, 26, 28]) {
      expect(beamY(x)).toBeLessThan(TRACE_BASELINE_Y)
    }
  })

  it('draws the dip and sharp QRS spike between x 34 and 53', () => {
    expect(beamY(34)).toBe(TRACE_BASELINE_Y)
    expect(beamY(38)).toBe(15)
    expect(beamY(43)).toBe(2)
    expect(beamY(48)).toBe(22)
    expect(beamY(53)).toBe(TRACE_BASELINE_Y)
    // The dip falls below the baseline, the rise climbs to the peak, and the
    // trough falls back through it.
    expect(beamY(36)).toBeGreaterThan(TRACE_BASELINE_Y)
    expect(beamY(38)).toBeGreaterThan(beamY(40))
    expect(beamY(40)).toBeGreaterThan(beamY(43))
    expect(beamY(50)).toBeGreaterThan(TRACE_BASELINE_Y)
  })

  it('draws the T bump between x 63 and 73', () => {
    expect(beamY(63)).toBe(TRACE_BASELINE_Y)
    expect(beamY(73)).toBe(TRACE_BASELINE_Y)
    expect(beamY(68)).toBe(8)
    expect(beamY(66)).toBeLessThan(TRACE_BASELINE_Y)
  })
})

describe('heartbeatBeam stepBeam (M87)', () => {
  it('advances the beam one step without wrapping', () => {
    expect(stepBeam(0)).toEqual({ x: HEARTBEAT_BEAM_STEP_PX, wrapped: false })
    expect(stepBeam(50)).toEqual({ x: 50 + HEARTBEAT_BEAM_STEP_PX, wrapped: false })
    expect(stepBeam(TRACE_WIDTH - HEARTBEAT_BEAM_STEP_PX)).toEqual({
      x: TRACE_WIDTH,
      wrapped: false,
    })
  })

  it('wraps past the right edge back to the left', () => {
    expect(stepBeam(TRACE_WIDTH + 0.1)).toEqual({ x: 0, wrapped: true })
  })
})
