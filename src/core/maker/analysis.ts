// D83.3/D83.6 (RLF-DEVICES): the G-code analyser and the machine/user
// limit check. Bounds, maximum temperature and feed are computed from
// the exact bytes and the machine's reported start position; geometry
// the analyser cannot bound exactly refuses the payload instead of
// understating. Pure functions over text: no connection, no surface.
import type { MakerAnalysis } from '../../shared/maker'
import {
  classifyMakerPayload,
  MAKER_AXIS_KEY,
  makerLineCommand,
  makerWordValue,
  parseMakerWords,
  type MakerRefusalReason,
  type MakerWord,
} from './classify'

export interface MakerEnvelopeTravel {
  readonly min?: { readonly x?: number; readonly y?: number; readonly z?: number }
  readonly max?: { readonly x?: number; readonly y?: number; readonly z?: number }
}

/**
One envelope shape for both sources D83.6 names: what the machine
reports and what the person entered when registering it. The executor
enforces the smaller of the two, field by field.
*/
export interface MakerEnvelopeLimits {
  readonly travelMm?: MakerEnvelopeTravel
  readonly maxTempC?: number
  readonly maxFeedMmMin?: number
}

export interface MakerPosition {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** Millimetres per inch: the exact defined conversion. */
const MM_PER_INCH = 25.4

const TWO_PI = Math.PI * 2
const CARDINAL_ANGLES = [0, Math.PI / 2, Math.PI, Math.PI + Math.PI / 2]
const HOME_AXES: readonly string[] = ['X', 'Y', 'Z']
const TEMP_COMMANDS = new Set(['M104', 'M109', 'M140', 'M190'])
const TEMP_LETTERS = ['S', 'R'] as const

export interface MakerMotionSummary {
  readonly hasMotion: boolean
  /** Every motion line homes; G28 may run on an unhomed machine. */
  readonly homingOnly: boolean
}

export type MakerAnalysisOutcome =
  | { readonly ok: true; readonly analysis: MakerAnalysis; readonly motion: MakerMotionSummary }
  | { readonly ok: false; readonly command: string }

interface GcodeCursor {
  units: 'mm' | 'inch'
  absolute: boolean
  position: { x: number; y: number; z: number }
  min: { x: number; y: number; z: number }
  max: { x: number; y: number; z: number }
  hasMotion: boolean
  homingOnly: boolean
  maxTempC: number | undefined
  maxFeedMmMin: number | undefined
}

type MakerWordList = readonly MakerWord[]

function normalizeAngle(angle: number): number {
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI
}

function isAngleInSweep(from: number, to: number, angle: number, isClockwise: boolean): boolean {
  const total = normalizeAngle(isClockwise ? from - to : to - from)
  // A zero sweep is a full circle: every cardinal crosses it.
  if (total === 0) return true
  const at = normalizeAngle(isClockwise ? from - angle : angle - from)
  return at <= total
}

function trackPoint(cursor: GcodeCursor, point: { x: number; y: number; z: number }): void {
  cursor.min.x = Math.min(cursor.min.x, point.x)
  cursor.min.y = Math.min(cursor.min.y, point.y)
  cursor.min.z = Math.min(cursor.min.z, point.z)
  cursor.max.x = Math.max(cursor.max.x, point.x)
  cursor.max.y = Math.max(cursor.max.y, point.y)
  cursor.max.z = Math.max(cursor.max.z, point.z)
}

/**
Exact arc extrema: the endpoints plus every cardinal crossing inside
the sweep, so the bounds never understate the toolpath. R-form centers
follow the minor/major convention (R>0 minor, R<0 major); a full
circle in R form has no defined center and refuses.
*/
function didTrackArc(
  cursor: GcodeCursor,
  command: string,
  words: MakerWordList,
  unit: number,
): boolean {
  const start = { ...cursor.position }
  const endX = makerWordValue(words, 'X')
  const endY = makerWordValue(words, 'Y')
  const endZ = makerWordValue(words, 'Z')
  if (endX === null || endY === null || endZ === null) return false
  const place = (raw: number | undefined, at: number): number =>
    cursor.absolute ? (raw === undefined ? at : raw * unit) : at + (raw ?? 0) * unit
  const target = { x: place(endX, start.x), y: place(endY, start.y), z: place(endZ, start.z) }
  const offsetI = makerWordValue(words, 'I')
  const offsetJ = makerWordValue(words, 'J')
  const radiusWord = makerWordValue(words, 'R')
  const isClockwise = command === 'G2'
  let center: { x: number; y: number }
  let radius: number
  if (offsetI !== undefined && offsetJ !== undefined) {
    if (offsetI === null || offsetJ === null) return false
    center = { x: start.x + offsetI * unit, y: start.y + offsetJ * unit }
    radius = Math.hypot(offsetI * unit, offsetJ * unit)
  } else if (radiusWord !== undefined && radiusWord !== null) {
    const chord = Math.hypot(target.x - start.x, target.y - start.y)
    const signed = radiusWord * unit
    if (signed === 0 || chord === 0 || chord > Math.abs(signed) * 2) return false
    const height = Math.sqrt(signed * signed - (chord / 2) * (chord / 2))
    const middle = { x: (start.x + target.x) / 2, y: (start.y + target.y) / 2 }
    const across = { x: -(target.y - start.y) / chord, y: (target.x - start.x) / chord }
    // R>0 takes the minor arc: clockwise leaves the center on the
    // right of travel, counter-clockwise on the left; R<0 takes the
    // major arc instead.
    const side = (isClockwise && signed > 0) || (!isClockwise && signed < 0) ? -1 : 1
    center = { x: middle.x + across.x * height * side, y: middle.y + across.y * height * side }
    radius = Math.abs(signed)
  } else {
    return false
  }
  if (radius === 0) return false
  const from = Math.atan2(start.y - center.y, start.x - center.x)
  const to = Math.atan2(target.y - center.y, target.x - center.x)
  trackPoint(cursor, start)
  trackPoint(cursor, target)
  for (const cardinal of CARDINAL_ANGLES) {
    if (isAngleInSweep(from, to, cardinal, isClockwise))
      trackPoint(cursor, {
        x: center.x + radius * Math.cos(cardinal),
        y: center.y + radius * Math.sin(cardinal),
        z: target.z,
      })
  }
  cursor.position = target
  cursor.hasMotion = true
  cursor.homingOnly = false
  return true
}

function didTrackLinear(
  cursor: GcodeCursor,
  words: MakerWordList,
  unit: number,
  isRelative: boolean,
): boolean {
  const isAbsolute = !isRelative && cursor.absolute
  const next = { ...cursor.position }
  let didMove = false
  for (const axis of ['X', 'Y', 'Z'] as const) {
    const raw = makerWordValue(words, axis)
    if (raw === undefined) continue
    if (raw === null) return false
    const key = MAKER_AXIS_KEY[axis]
    next[key] = isAbsolute ? raw * unit : next[key] + raw * unit
    didMove = true
  }
  if (didMove) {
    trackPoint(cursor, cursor.position)
    trackPoint(cursor, next)
    cursor.position = next
    cursor.hasMotion = true
    cursor.homingOnly = false
  }
  return true
}

function trackFeed(cursor: GcodeCursor, words: MakerWordList, unit: number): void {
  const feed = makerWordValue(words, 'F')
  if (feed !== undefined && feed !== null)
    cursor.maxFeedMmMin = Math.max(cursor.maxFeedMmMin ?? feed * unit, feed * unit)
}

function trackTemps(cursor: GcodeCursor, words: MakerWordList): void {
  for (const letter of TEMP_LETTERS) {
    const temp = makerWordValue(words, letter)
    if (temp !== undefined && temp !== null)
      cursor.maxTempC = Math.max(cursor.maxTempC ?? temp, temp)
  }
}

function trackHome(cursor: GcodeCursor, words: MakerWordList): void {
  const next = { ...cursor.position }
  // Bare G28 homes every axis; named axes home only those.
  const hasNamedAxes = HOME_AXES.some((axis) => words.some((word) => word.letter === axis))
  for (const [upper, key] of Object.entries(MAKER_AXIS_KEY)) {
    if (!hasNamedAxes || words.some((word) => word.letter === upper)) next[key] = 0
  }
  trackPoint(cursor, cursor.position)
  trackPoint(cursor, next)
  cursor.position = next
  if (!cursor.hasMotion) cursor.homingOnly = true
  cursor.hasMotion = true
}

/**
D83.3's analysis, computed from the exact bytes and the machine's
reported start position: bounds, maximum temperature and feed, and
the commands the analyser does not know. Geometry the analyser
cannot bound exactly refuses the payload instead of understating.
*/
export function analyzeMakerPayload(
  kind: 'printer' | 'cnc',
  payload: Uint8Array,
  start: MakerPosition,
): MakerAnalysisOutcome {
  const text = Buffer.from(payload).toString('utf8')
  const cursor: GcodeCursor = {
    units: 'mm',
    absolute: true,
    position: { ...start },
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
    hasMotion: false,
    homingOnly: false,
    maxTempC: undefined,
    maxFeedMmMin: undefined,
  }
  for (const line of text.split('\n')) {
    const words = parseMakerWords(line)
    if (words.length === 0) continue
    const unit = cursor.units === 'mm' ? 1 : MM_PER_INCH
    const command = makerLineCommand(line)
    if (command === 'G20') {
      cursor.units = 'inch'
      continue
    }
    if (command === 'G21') {
      cursor.units = 'mm'
      continue
    }
    if (command === 'G90') {
      cursor.absolute = true
      continue
    }
    if (command === 'G91') {
      cursor.absolute = false
      continue
    }
    if (['G0', 'G1'].includes(command)) {
      trackFeed(cursor, words, unit)
      if (!didTrackLinear(cursor, words, unit, false)) return { ok: false, command }
      continue
    }
    if (['G2', 'G3'].includes(command)) {
      trackFeed(cursor, words, unit)
      if (!didTrackArc(cursor, command, words, unit)) return { ok: false, command }
      continue
    }
    if (command === 'G') {
      // A motion letter with no parseable number and axis words the
      // analyser cannot place refuses instead of understating.
      const hasAxes = words.some(
        (word) => HOME_AXES.includes(word.letter) && word.value !== null && word.letter !== 'G',
      )
      if (hasAxes) return { ok: false, command }
      continue
    }
    if (command === 'G28') {
      trackFeed(cursor, words, unit)
      trackHome(cursor, words)
      continue
    }
    if (command === '$H') {
      trackFeed(cursor, words, unit)
      trackHome(cursor, [])
      continue
    }
    if (command === 'G92') {
      for (const axis of ['X', 'Y', 'Z'] as const) {
        const raw = makerWordValue(words, axis)
        if (raw === undefined) continue
        if (raw === null) return { ok: false, command }
        cursor.position[MAKER_AXIS_KEY[axis]] = raw * unit
      }
      continue
    }
    if (command === '$J') {
      trackFeed(cursor, words, unit)
      if (!didTrackLinear(cursor, words, unit, true)) return { ok: false, command }
      continue
    }
    if (TEMP_COMMANDS.has(command)) {
      trackTemps(cursor, words)
      continue
    }
    trackFeed(cursor, words, unit)
  }
  const unknownCommands = classifyMakerPayload(kind, text).unknownCommands
  const analysis: MakerAnalysis = {
    ...(cursor.hasMotion && { bounds: { min: { ...cursor.min }, max: { ...cursor.max } } }),
    ...(cursor.maxTempC !== undefined && { maxTempC: cursor.maxTempC }),
    ...(cursor.maxFeedMmMin !== undefined && { maxFeedMmMin: cursor.maxFeedMmMin }),
    unknownCommands: [...unknownCommands],
  }
  return {
    ok: true,
    analysis,
    motion: { hasMotion: cursor.hasMotion, homingOnly: cursor.homingOnly },
  }
}

export interface MakerLimitCheck {
  readonly analysis: MakerAnalysis
  readonly motion: MakerMotionSummary
  readonly machine: MakerEnvelopeLimits
  readonly user?: MakerEnvelopeLimits
  readonly homed: boolean
  readonly softLimits: boolean
}

export type MakerLimitsVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: MakerRefusalReason; readonly detail?: string }

function isPresent(value: number | undefined): value is number {
  return value !== undefined
}

/**
D83.6: travel, temperature and feed are the smaller of what the
machine reports and what the person entered. Outside refuses without
asking; with no limits only stop and observe work; travel counts only
on a homed machine with soft limits.
*/
export function checkMakerLimits(check: MakerLimitCheck): MakerLimitsVerdict {
  const travels = [check.machine.travelMm, check.user?.travelMm].filter(
    (travel) => travel !== undefined,
  )
  const hasTravel = travels.some(
    (travel) =>
      travel.min?.x !== undefined ||
      travel.min?.y !== undefined ||
      travel.min?.z !== undefined ||
      travel.max?.x !== undefined ||
      travel.max?.y !== undefined ||
      travel.max?.z !== undefined,
  )
  const temps = [check.machine.maxTempC, check.user?.maxTempC].filter(isPresent)
  const feeds = [check.machine.maxFeedMmMin, check.user?.maxFeedMmMin].filter(isPresent)
  if (!hasTravel && temps.length === 0 && feeds.length === 0)
    return { ok: false, reason: 'no-limits' }
  if (check.motion.hasMotion && !check.motion.homingOnly && (!check.homed || !check.softLimits))
    return { ok: false, reason: 'unhomed' }
  const bounds = check.analysis.bounds
  if (bounds !== undefined) {
    for (const axis of ['x', 'y', 'z'] as const) {
      const mins = travels.map((travel) => travel.min?.[axis]).filter(isPresent)
      const maxes = travels.map((travel) => travel.max?.[axis]).filter(isPresent)
      const floor = mins.length === 0 ? undefined : Math.max(...mins)
      const ceiling = maxes.length === 0 ? undefined : Math.min(...maxes)
      if (floor === undefined && ceiling === undefined) continue
      if (floor !== undefined && bounds.min[axis] !== undefined && bounds.min[axis] < floor)
        return {
          ok: false,
          reason: 'outside-limits',
          detail: `${axis}: ${String(bounds.min[axis])} < min ${String(floor)}`,
        }
      if (ceiling !== undefined && bounds.max[axis] !== undefined && bounds.max[axis] > ceiling)
        return {
          ok: false,
          reason: 'outside-limits',
          detail: `${axis}: ${String(bounds.max[axis])} > max ${String(ceiling)}`,
        }
    }
  }
  const maxTempC = check.analysis.maxTempC
  if (maxTempC !== undefined && temps.length > 0) {
    const ceiling = Math.min(...temps)
    if (maxTempC > ceiling)
      return {
        ok: false,
        reason: 'outside-limits',
        detail: `temp: ${String(maxTempC)} > max ${String(ceiling)}`,
      }
  }
  const maxFeed = check.analysis.maxFeedMmMin
  if (maxFeed !== undefined && feeds.length > 0) {
    const ceiling = Math.min(...feeds)
    if (maxFeed > ceiling)
      return {
        ok: false,
        reason: 'outside-limits',
        detail: `feed: ${String(maxFeed)} > max ${String(ceiling)}`,
      }
  }
  return { ok: true }
}
