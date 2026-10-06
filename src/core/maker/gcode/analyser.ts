import { gcodeClass, type GcodeClass, type GcodeDialect } from './dialects'
import { tokenizeGcode, type GcodeBlock, type GcodePolicy } from './tokenizer'

export interface Point {
  readonly x: number
  readonly y: number
  readonly z: number
}
export interface Bounds {
  readonly min: Point
  readonly max: Point
}
export interface GcodeState {
  readonly position: Point
  readonly absolute: boolean
  readonly unit: 'mm' | 'inch'
  readonly feedMmMin: number
}
export interface GcodeAnalysis {
  readonly classes: readonly GcodeClass[]
  readonly bounds: Bounds | undefined
  readonly maxFeedMmMin: number
  readonly temperatures: Readonly<Partial<Record<'extruder' | 'bed', number>>>
  readonly unknown: readonly string[]
  readonly refused: readonly string[]
  readonly hasMotion: boolean
}

function point(x: number, y: number, z: number): Point {
  return { x, y, z }
}
function include(bounds: Bounds | undefined, next: Point): Bounds {
  if (bounds === undefined) return { min: next, max: next }
  return {
    min: point(
      Math.min(bounds.min.x, next.x),
      Math.min(bounds.min.y, next.y),
      Math.min(bounds.min.z, next.z),
    ),
    max: point(
      Math.max(bounds.max.x, next.x),
      Math.max(bounds.max.y, next.y),
      Math.max(bounds.max.z, next.z),
    ),
  }
}

/**
 * Bounds are conservative. XY I/J arcs include the complete circle, including
 * helical Z endpoints. R arcs, offsets, extrusion and opaque macros have
 * unknown effects and cannot be sent. This is an analyser, not a firmware emulator.
 */
export function analyseGcode(
  payload: string | readonly GcodeBlock[],
  dialect: GcodeDialect,
  initial: GcodeState,
  policy: GcodePolicy,
): GcodeAnalysis {
  const blocks = typeof payload === 'string' ? tokenizeGcode(payload, policy) : payload
  let position = initial.position
  let isAbsolute = initial.absolute
  let scale = initial.unit === 'mm' ? 1 : policy.mmPerInch
  let feed = initial.feedMmMin
  let bounds: Bounds | undefined
  let maxFeedMmMin = 0
  let hasMotion = false
  const temperatures: Partial<Record<'extruder' | 'bed', number>> = {}
  const unknown = new Set<string>()
  const refused = new Set<string>()
  const classes = new Set<GcodeClass>()
  for (const block of blocks) {
    const { command, parameters: p } = block
    const classification = gcodeClass(command, dialect)
    classes.add(classification)
    if (classification === 'refused') {
      refused.add(command)
      continue
    }
    if (classification === 'observe') {
      if (Object.keys(p).length > 0 || (block.isMacro && block.hasArguments)) unknown.add(command)
      continue
    }
    const isMode = ['G20', 'G21', 'G90', 'G91', 'M82', 'M83'].includes(command)
    if (isMode) {
      if (Object.keys(p).length > 0) unknown.add(command)
      switch (command) {
        case 'G20': {
          scale = policy.mmPerInch
          continue
        }
        case 'G21': {
          scale = 1
          continue
        }
        case 'G90': {
          isAbsolute = true
          continue
        }
        case 'G91': {
          isAbsolute = false
          continue
        }
        default: {
          continue
        }
      }
    }

    if (dialect !== 'grbl' && ['M104', 'M109', 'M140', 'M190'].includes(command)) {
      const temperature = p['S'] ?? p['R']
      if (
        temperature === undefined ||
        temperature < 0 ||
        Object.keys(p).some((key) => !['S', 'R'].includes(key)) ||
        ('S' in p && 'R' in p)
      ) {
        unknown.add(command)
      } else {
        const heater = command === 'M140' || command === 'M190' ? 'bed' : 'extruder'
        temperatures[heater] = Math.max(temperatures[heater] ?? 0, temperature)
      }
      continue
    }
    if (!['G0', 'G1', 'G2', 'G3'].includes(command)) {
      unknown.add(command)
      continue
    }
    hasMotion = true
    if (
      Object.keys(p).some((key) => !['X', 'Y', 'Z', 'F', 'I', 'J'].includes(key)) ||
      ((command === 'G0' || command === 'G1') && ('I' in p || 'J' in p))
    ) {
      unknown.add(command)
    }
    if (p['F'] !== undefined) feed = p['F'] * scale
    if (feed <= 0 || !Number.isFinite(feed)) unknown.add(command)
    maxFeedMmMin = Math.max(maxFeedMmMin, feed)
    const coordinate = (letter: string, current: number): number =>
      p[letter] === undefined ? current : p[letter] * scale + (isAbsolute ? 0 : current)
    const next = point(
      coordinate('X', position.x),
      coordinate('Y', position.y),
      coordinate('Z', position.z),
    )
    bounds = include(include(bounds, position), next)
    if (command === 'G2' || command === 'G3') {
      if (!('I' in p || 'J' in p)) unknown.add(command)
      const i = (p['I'] ?? 0) * scale
      const j = (p['J'] ?? 0) * scale
      const radius = Math.hypot(i, j)
      const cx = position.x + i
      const cy = position.y + j
      // A mismatched endpoint may be accepted differently by firmware: bound
      // both radii rather than assuming a tolerance from a particular dialect.
      const outer = Math.max(radius, Math.hypot(next.x - cx, next.y - cy))
      bounds = include(
        include(bounds, point(cx - outer, cy - outer, Math.min(position.z, next.z))),
        point(cx + outer, cy + outer, Math.max(position.z, next.z)),
      )
    }
    if ([next.x, next.y, next.z, scale].some((value) => !Number.isFinite(value)))
      unknown.add(command)
    position = next
  }
  return {
    classes: [...classes],
    bounds,
    maxFeedMmMin,
    temperatures,
    unknown: [...unknown],
    refused: [...refused],
    hasMotion,
  }
}
