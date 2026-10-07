import type * as z from 'zod/mini'
import type { Bounds, GcodeAnalysis } from './analyser'

import { type makerLimitsSchema as limitsSchema } from '../../../shared/makerProtocol'
export {
  makerLimitsSchema as limitsSchema,
  makerPointSchema as pointSchema,
} from '../../../shared/makerProtocol'

export type MachineLimits = z.infer<typeof limitsSchema>
export type LimitsFailure =
  | 'refusedCommand'
  | 'unknownEffects'
  | 'unknownLimits'
  | 'unhomed'
  | 'travelLimit'
  | 'feedLimit'
  | 'temperatureLimit'

/** Intersect the machine's report with the user's registration; missing remains missing. */
export function effectiveLimits(machine: MachineLimits, user: MachineLimits): MachineLimits {
  const result: MachineLimits = {}
  if (machine.travel !== undefined && user.travel !== undefined) {
    const min = {
      x: Math.max(machine.travel.min.x, user.travel.min.x),
      y: Math.max(machine.travel.min.y, user.travel.min.y),
      z: Math.max(machine.travel.min.z, user.travel.min.z),
    }
    const max = {
      x: Math.min(machine.travel.max.x, user.travel.max.x),
      y: Math.min(machine.travel.max.y, user.travel.max.y),
      z: Math.min(machine.travel.max.z, user.travel.max.z),
    }
    if (min.x <= max.x && min.y <= max.y && min.z <= max.z) result.travel = { min, max }
  }
  for (const key of ['feedMmMin', 'extruder', 'bed'] as const) {
    if (machine[key] !== undefined && user[key] !== undefined)
      result[key] = Math.min(machine[key], user[key])
  }
  return result
}
function isInside(bounds: Bounds, travel: Bounds): boolean {
  return (
    bounds.min.x >= travel.min.x &&
    bounds.max.x <= travel.max.x &&
    bounds.min.y >= travel.min.y &&
    bounds.max.y <= travel.max.y &&
    bounds.min.z >= travel.min.z &&
    bounds.max.z <= travel.max.z
  )
}
export function checkGcodeLimits(
  analysis: GcodeAnalysis,
  limits: MachineLimits,
  isHomed: boolean,
): LimitsFailure | undefined {
  if (analysis.refused.length > 0) return 'refusedCommand'
  if (analysis.unknown.length > 0) return 'unknownEffects'
  // Unknown limits allow only the separate status and stop paths.
  if (limits.travel === undefined || limits.feedMmMin === undefined) return 'unknownLimits'
  if (!isHomed && analysis.hasMotion) return 'unhomed'
  if (analysis.bounds !== undefined && !isInside(analysis.bounds, limits.travel))
    return 'travelLimit'
  if (analysis.maxFeedMmMin > limits.feedMmMin) return 'feedLimit'
  for (const heater of ['extruder', 'bed'] as const) {
    const target = analysis.temperatures[heater]
    if (target === undefined) continue
    const limit = limits[heater]
    if (limit === undefined) return 'unknownLimits'
    if (target > limit) return 'temperatureLimit'
  }
  return undefined
}
