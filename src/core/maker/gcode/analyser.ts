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
 * Bounds are conservative: telemetry does not certify the active arc plane,
 * so arcs include complete circles in XY, XZ and YZ, plus helical endpoints.
 * R/K arcs, coordinate offsets, extrusion and opaque macros still have unknown
 * effects and cannot be sent. This is an analyser, not a firmware emulator.
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
      const offsets = {
        x: (p['I'] ?? 0) * scale,
        y: (p['J'] ?? 0) * scale,
        z: (p['K'] ?? 0) * scale,
      }
      // Other clients can select G18/G19 without changing represented status.
      // Include every possible plane instead of inventing a telemetry field
      // or silently sending a plane selector the user did not approve.
      for (const [first, second, helix] of [
        ['x', 'y', 'z'],
        ['x', 'z', 'y'],
        ['y', 'z', 'x'],
      ] as const) {
        const cx = position[first] + offsets[first]
        const cy = position[second] + offsets[second]
        // Bound both radii; firmware endpoint tolerances are not assumed.
        const outer = Math.max(
          Math.hypot(offsets[first], offsets[second]),
          Math.hypot(next[first] - cx, next[second] - cy),
        )
        const low = { ...position }
        const high = { ...position }
        low[first] = cx - outer
        low[second] = cy - outer
        low[helix] = Math.min(position[helix], next[helix])
        high[first] = cx + outer
        high[second] = cy + outer
        high[helix] = Math.max(position[helix], next[helix])
        bounds = include(include(bounds, low), high)
      }
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
