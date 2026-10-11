// M117 W (PLAN.md D100, gotcha G4): a lane built on a base older than
// ESTIMATE_STALE_BASE_DAYS is a schedule risk. Merging current main has
// broken such lanes' releases before, so the estimate names the lane in
// `risks` instead of pricing a rebase it cannot see. A lane without a base
// is unknown, never fresh: it is not flagged and not claimed fresh.
import * as z from 'zod/mini'
import { ESTIMATE_STALE_BASE_DAYS, MILLISECONDS_PER_DAY } from '../../shared/constants'
import { historyRecordSchema, type EstimateLane, type HistoryRecord } from '../../shared/estimate'
import { UI_TEXT, fill } from '../../shared/l10n/text'
import { calibrationFailure } from './calibration/records'

export interface StaleBaseLane {
  readonly laneId: string
  readonly baseAgeDays: number
}

/** Lanes whose base is at least ESTIMATE_STALE_BASE_DAYS old, oldest first. */
export function staleBaseLanes(lanes: readonly EstimateLane[], asOf: string): StaleBaseLane[] {
  if (!z.iso.datetime().safeParse(asOf).success) throw calibrationFailure('invalidBaseAge')
  const now = Date.parse(asOf)
  const stale: StaleBaseLane[] = []
  for (const lane of lanes) {
    if (lane.baseAsOf === undefined) continue
    const base = Date.parse(lane.baseAsOf)
    if (!Number.isFinite(base) || base > now) throw calibrationFailure('invalidBaseAge')
    const baseAgeDays = Math.floor((now - base) / MILLISECONDS_PER_DAY)
    if (baseAgeDays >= ESTIMATE_STALE_BASE_DAYS) stale.push({ laneId: lane.id, baseAgeDays })
  }
  return stale.toSorted((left, right) => {
    if (right.baseAgeDays !== left.baseAgeDays) return right.baseAgeDays - left.baseAgeDays
    return left.laneId < right.laneId ? -1 : 1
  })
}

/** The section's G4 risks for these lanes, in lane order. */
export function baseRisks(
  lanes: readonly EstimateLane[],
  asOf: string,
): {
  readonly laneId: string
  readonly kind: 'staleBase'
}[] {
  const ids = new Set(staleBaseLanes(lanes, asOf).map((lane) => lane.laneId))
  return lanes
    .filter((lane) => ids.has(lane.id))
    .map((lane) => ({ laneId: lane.id, kind: 'staleBase' as const }))
}

/** Read at render time so changing the installed language changes the label. */
export function staleBaseText(lanes: readonly { laneId: string }[]): string {
  return fill(UI_TEXT.estimateStaleBase, {
    lanes: lanes.map((lane) => lane.laneId).join(', '),
  })
}

/**
 * First-pass finding rate for one engine (playbook §4): among that engine's
 * lanes with known review state, the fraction needing at least one review
 * round. Unknown review state is excluded, never counted as clean.
 */
export function engineFindingRate(
  values: readonly HistoryRecord[],
  engine: HistoryRecord['engine'],
): number {
  if (!historyRecordSchema.shape.engine.safeParse(engine).success)
    throw calibrationFailure('invalidEngine')
  const scoped = values.filter(
    (value) => (engine === undefined || value.engine === engine) && value.review.status === 'known',
  )
  return scoped.length === 0
    ? 0
    : scoped.filter((value) => value.review.status === 'known' && value.review.rounds > 0).length /
        scoped.length
}
