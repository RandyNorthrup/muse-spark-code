// The flight recorder's records as the problem report reads them (M93,
// PLAN.md D72): a fixed kind, a known code, package frames and a relative
// age. The absolute time, the versions and anything else a record holds stay
// in the journal. Shared by the extension's dialog and the agent's `report`.

import type { ProblemReportEvent } from './problemReport'
import type { FlightRecord } from './flightRecorder'

/**
 * The report's events for these records at `nowMs`. A record stamped after
 * `nowMs` (the clock moved back) reads as just now rather than being lost.
 */
export function reportEventsOf(
  records: readonly FlightRecord[],
  nowMs: number,
): readonly ProblemReportEvent[] {
  return records.map((record) => ({
    kind: record.kind,
    code: record.code,
    frames: record.frames,
    ageMs: Math.max(0, nowMs - record.at),
  }))
}
