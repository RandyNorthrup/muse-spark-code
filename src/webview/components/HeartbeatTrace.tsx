// The working line's heart-monitor trace (M87, D66): a canvas the beam draws
// itself, after Vahid's HTML5 Canvas Heart Monitor (CodePen MWvmvd, MIT;
// written fresh). Nothing static is drawn: one requestAnimationFrame loop
// moves the beam right in fixed 6 ms ticks along our P/QRS/T wave (beamY in
// heartbeatBeam.ts). Each frame clears the canvas and strokes only the
// beam's last HEARTBEAT_BEAM_TRAIL_TICKS ticks of path, fading by age, so
// the wave exists only as the blip's own trail; then it wraps and repeats.
// Decorative and aria-hidden: still under reduced motion, CanvasText under
// forced colours.

import { useEffect, useRef } from 'react'
import {
  HEARTBEAT_BEAM_LINE_WIDTH_PX,
  HEARTBEAT_BEAM_MAX_TICKS_PER_FRAME,
  HEARTBEAT_BEAM_TICK_MS,
  HEARTBEAT_BEAM_TRAIL_TICKS,
} from '../../shared/constants'
import {
  beamY,
  stepBeam,
  trailSegments,
  TRACE_HEIGHT,
  TRACE_WIDTH,
  type BeamStep,
  type TrailPoint,
} from '../heartbeatBeam'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const FORCED_COLORS_QUERY = '(forced-colors: active)'
/** Sampling step for the single still beat under reduced motion. */
const STILL_STEP_PX = 1

function beamColor(canvas: HTMLCanvasElement, isForcedColors: boolean): string {
  if (isForcedColors) {
    return 'CanvasText'
  }
  const themed = getComputedStyle(canvas).getPropertyValue('--ms-progress').trim()
  return themed === '' ? 'currentColor' : themed
}

export function HeartbeatTrace() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (canvas === null) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (ctx == null) {
      return
    }
    const reduced = window.matchMedia(REDUCED_MOTION_QUERY)
    const forced = window.matchMedia(FORCED_COLORS_QUERY)
    let beamX = 0
    let tickCount = 0
    let trail: TrailPoint[] = []
    let debtMs = 0
    let lastMs = 0
    let frame = 0
    let scaleX = 1
    let scaleY = 1
    let unitPx = 1
    let color = beamColor(canvas, forced.matches)

    const size = () => {
      const cssWidth = canvas.clientWidth
      const cssHeight = canvas.clientHeight
      if (cssWidth > 0 && cssHeight > 0) {
        const ratio = window.devicePixelRatio
        canvas.width = Math.round(cssWidth * ratio)
        canvas.height = Math.round(cssHeight * ratio)
      }
      scaleX = canvas.width / TRACE_WIDTH
      scaleY = canvas.height / TRACE_HEIGHT
      unitPx = canvas.width / (canvas.clientWidth > 0 ? canvas.clientWidth : canvas.width)
    }

    const strokeSegment = (fromX: number, toX: number, alpha: number) => {
      // A cached Path2D would freeze the beam: every frame strokes the
      // trail's segments where the beam has just been.
      ctx.beginPath()
      // eslint-disable-next-line unicorn/prefer-path2d
      ctx.moveTo(fromX * scaleX, beamY(fromX) * scaleY)
      ctx.lineTo(toX * scaleX, beamY(toX) * scaleY)
      ctx.globalAlpha = alpha
      ctx.stroke()
    }

    const tick = () => {
      const next: BeamStep = stepBeam(beamX)
      beamX = next.x
      tickCount += 1
      if (next.wrapped) {
        // Pen lift at the right edge: restart from the left, re-reading the
        // theme colour so a theme change lands within one sweep.
        color = beamColor(canvas, forced.matches)
      }
      trail.push({ x: beamX, tick: tickCount, isPenDown: !next.wrapped })
      // Keep one point older than the trail, so its oldest segment has a start.
      while (trail.length > HEARTBEAT_BEAM_TRAIL_TICKS + 1) {
        trail.shift()
      }
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.save()
      ctx.strokeStyle = color
      ctx.lineWidth = HEARTBEAT_BEAM_LINE_WIDTH_PX * unitPx
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const segment of trailSegments(trail, tickCount, HEARTBEAT_BEAM_TRAIL_TICKS)) {
        strokeSegment(segment.fromX, segment.toX, segment.alpha)
      }
      ctx.restore()
    }

    const onFrame = (now: number) => {
      frame = requestAnimationFrame(onFrame)
      debtMs += now - lastMs
      lastMs = now
      let ticks = 0
      while (debtMs >= HEARTBEAT_BEAM_TICK_MS && ticks < HEARTBEAT_BEAM_MAX_TICKS_PER_FRAME) {
        tick()
        debtMs -= HEARTBEAT_BEAM_TICK_MS
        ticks += 1
      }
      if (debtMs >= HEARTBEAT_BEAM_TICK_MS) {
        debtMs = 0
      }
      if (ticks > 0) {
        draw()
      }
    }

    const stop = () => {
      cancelAnimationFrame(frame)
      frame = 0
    }

    const drawStill = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.beginPath()
      ctx.moveTo(0, beamY(0) * scaleY)
      for (let x = STILL_STEP_PX; x <= TRACE_WIDTH; x += STILL_STEP_PX) {
        ctx.lineTo(x * scaleX, beamY(x) * scaleY)
      }
      ctx.strokeStyle = beamColor(canvas, forced.matches)
      ctx.lineWidth = HEARTBEAT_BEAM_LINE_WIDTH_PX * unitPx
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
    }

    const start = () => {
      stop()
      if (document.hidden) {
        return
      }
      size()
      if (reduced.matches) {
        drawStill()
        return
      }
      beamX = 0
      tickCount = 0
      trail = [{ x: 0, tick: 0, isPenDown: false }]
      debtMs = 0
      lastMs = 0
      color = beamColor(canvas, forced.matches)
      frame = requestAnimationFrame(onFrame)
    }

    const onVisibility = () => {
      if (document.hidden) {
        stop()
        return
      }
      start()
    }

    const onResize = () => {
      size()
    }

    const onMedia = () => {
      start()
    }

    reduced.addEventListener('change', onMedia)
    forced.addEventListener('change', onMedia)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('resize', onResize)
    start()
    return () => {
      stop()
      reduced.removeEventListener('change', onMedia)
      forced.removeEventListener('change', onMedia)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('resize', onResize)
    }
  }, [])
  return <canvas ref={ref} className="heartbeat-trace" aria-hidden="true" />
}
