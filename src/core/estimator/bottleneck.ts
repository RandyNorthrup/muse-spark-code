import { type EstimateLane, type EstimateSection, type FleetSnapshot } from '../../shared/estimate'
import { prepareEstimateSchedule, type EstimateRelaxation } from './schedule'
import { UI_TEXT, fill } from '../../shared/l10n/text'

/** Remove one resource class at a time, using the same duration samples.
 * Unbounded machines means identical compatible replicas with their same
 * per-machine caps/roles; account and CI limits remain shared. Unbounded slots
 * retain the machine's governor caps. Ties prefer the smaller slot expansion.
 */
export function findEstimateBottleneck(
  lanes: readonly EstimateLane[],
  fleet: FleetSnapshot,
  durations?: ReadonlyMap<string, ReadonlyMap<string, number>>,
): EstimateSection['limitingResource'] {
  const baseline = prepareEstimateSchedule(lanes, fleet).run(durations)
  let result: EstimateSection['limitingResource'] = {
    kind: 'criticalPath',
    hoursSavedIfUnbounded: 0,
    moreAgentsHelp: false,
  }
  const resources: EstimateRelaxation[] = ['slots', 'accountRate', 'ci', 'disk', 'machines']
  for (const kind of resources) {
    const relaxed = prepareEstimateSchedule(lanes, fleet, kind).run(durations)
    // List heuristics can choose a different ordering; a relaxation that
    // worsens it is not a speedup and cannot yield negative savings.
    const saved = Math.max(0, baseline.finishHours - relaxed.finishHours)
    const epsilon = Number.EPSILON * Math.max(1, baseline.finishHours) * Math.max(1, lanes.length)
    if (saved > result.hoursSavedIfUnbounded + epsilon)
      result = {
        kind,
        hoursSavedIfUnbounded: saved,
        moreAgentsHelp: kind === 'machines' || kind === 'slots',
      }
  }
  const epsilon = Number.EPSILON * Math.max(1, baseline.finishHours) * Math.max(1, lanes.length)
  if (result.kind === 'criticalPath' && baseline.finishHours > baseline.criticalPathHours + epsilon)
    throw new Error(fill(UI_TEXT.estimateFailed, { detail: 'coupled-resources' }))
  return result
}
