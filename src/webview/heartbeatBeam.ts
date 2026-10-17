// The working line's heart-monitor beam (M87, D66).
//
// After Vahid's HTML5 Canvas Heart Monitor, CodePen MWvmvd, MIT; written
// fresh: only the animation is his. His loop moves a beam right step by step,
// drawing short segments, while every tick repaints the screen with a
// translucent background so everything already drawn fades (phosphor
// persistence); the shape exists only as the beam's fading trail, and the
// beam wraps and repeats. The shape stays ours: the beam's height follows
// beamY below, our P/QRS/T waveform sampled in the trace's 0..100 by 0..24
// box. Instead of repainting a translucent background (which on an 8-bit
// canvas never fully clears, so a ghost of the whole wave lingered and the
// beam seemed to run along it), each frame clears the canvas and redraws only
// the trail's last ticks, fading by age (trailSegments).

import { HEARTBEAT_BEAM_STEP_PX } from '../shared/constants'

/** Trace box the waveform is sampled in. */
export const TRACE_WIDTH = 100
export const TRACE_HEIGHT = 24
/** Flat baseline the beam rests on between beats. */
export const TRACE_BASELINE_Y = 12

// P bump: flat 0-18, two quadratics 18-29, flat to 34.
const P_START_X = 18
const P_JOINT_X = 24
const P_END_X = 29
const P_FIRST_CP_Y = 12
const P_FIRST_END_Y = 9
const P_SECOND_CP_Y = 6
// QRS spike: flat to 34, dip at 38, sharp rise to y=2 at 43, down to 22 at
// 48, back to the baseline at 53.
const QRS_START_X = 34
const QRS_DIP_X = 38
const QRS_DIP_Y = 15
const QRS_PEAK_X = 43
const QRS_PEAK_Y = 2
const QRS_TROUGH_X = 48
const QRS_TROUGH_Y = 22
const QRS_END_X = 53
// T bump: flat 53-63, one quadratic 63-73, flat to 100.
const T_START_X = 63
const T_END_X = 73
const T_CP_Y = 4

function lineY(x0: number, y0: number, x1: number, y1: number, x: number): number {
  const t = (x - x0) / (x1 - x0)
  return y0 + t * (y1 - y0)
}

function quadY(p0: number, cp: number, p1: number, t: number): number {
  const a = 1 - t
  return a * a * p0 + (t + t) * a * cp + t * t * p1
}

/**
 * Beam height for beam position x in 0..100, following our P/QRS/T waveform:
 * flat at the baseline, a small P bump, the dip and sharp QRS spike, a T
 * bump, flat to the right edge.
 */
export function beamY(x: number): number {
  if (x < P_START_X) {
    return TRACE_BASELINE_Y
  }
  if (x < P_JOINT_X) {
    return quadY(
      TRACE_BASELINE_Y,
      P_FIRST_CP_Y,
      P_FIRST_END_Y,
      (x - P_START_X) / (P_JOINT_X - P_START_X),
    )
  }
  if (x < P_END_X) {
    return quadY(
      P_FIRST_END_Y,
      P_SECOND_CP_Y,
      TRACE_BASELINE_Y,
      (x - P_JOINT_X) / (P_END_X - P_JOINT_X),
    )
  }
  if (x < QRS_START_X) {
    return TRACE_BASELINE_Y
  }
  if (x < QRS_DIP_X) {
    return lineY(QRS_START_X, TRACE_BASELINE_Y, QRS_DIP_X, QRS_DIP_Y, x)
  }
  if (x < QRS_PEAK_X) {
    return lineY(QRS_DIP_X, QRS_DIP_Y, QRS_PEAK_X, QRS_PEAK_Y, x)
  }
  if (x < QRS_TROUGH_X) {
    return lineY(QRS_PEAK_X, QRS_PEAK_Y, QRS_TROUGH_X, QRS_TROUGH_Y, x)
  }
  if (x < QRS_END_X) {
    return lineY(QRS_TROUGH_X, QRS_TROUGH_Y, QRS_END_X, TRACE_BASELINE_Y, x)
  }
  if (x < T_START_X) {
    return TRACE_BASELINE_Y
  }
  return x < T_END_X
    ? quadY(TRACE_BASELINE_Y, T_CP_Y, TRACE_BASELINE_Y, (x - T_START_X) / (T_END_X - T_START_X))
    : TRACE_BASELINE_Y
}

export interface BeamStep {
  /** Next beam position. */
  x: number
  /** True when the beam wrapped past the right edge: lift the pen. */
  wrapped: boolean
}

/** Advance the beam one tick right; past the right edge it restarts at 0. */
export function stepBeam(x: number): BeamStep {
  const next = x + HEARTBEAT_BEAM_STEP_PX
  return next > TRACE_WIDTH ? { x: 0, wrapped: true } : { x: next, wrapped: false }
}

/** Where the beam was at one tick; `isPenDown` is false where it restarted at the left edge. */
export interface TrailPoint {
  readonly x: number
  readonly tick: number
  readonly isPenDown: boolean
}

/** One stroke of the trail, with its opacity. */
export interface TrailSegment {
  readonly fromX: number
  readonly toX: number
  readonly alpha: number
}

/**
 * The strokes to draw this frame: only the beam's last `trailTicks` ticks of
 * path, oldest first, fading from opaque at the beam to nothing at the end of
 * the trail. Nothing older is returned, and the canvas is cleared before
 * these are drawn, so no part of the waveform exists except what the beam
 * has just drawn (the owner's rule: the shape comes from the blip).
 */
export function trailSegments(
  points: readonly TrailPoint[],
  nowTick: number,
  trailTicks: number,
): readonly TrailSegment[] {
  const segments: TrailSegment[] = []
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]
    const to = points[index]
    if (from === undefined || !to?.isPenDown) {
      continue
    }
    const alpha = 1 - (nowTick - to.tick) / trailTicks
    if (alpha > 0) {
      segments.push({ fromX: from.x, toX: to.x, alpha })
    }
  }
  return segments
}
