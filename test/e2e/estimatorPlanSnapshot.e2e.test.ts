import { describe, expect, it } from 'vitest'
import { buildPlanSnapshot } from '../../src/core/estimator/planSnapshot'
import { fitCalibration } from '../../src/core/estimator/calibration/fit'
import { resolveEstimateGoal } from '../../src/core/estimator/goal'
import { localFleet } from '../../src/host/estimator/localFleet'
import { simulateEstimate, type EstimateDurationPort } from '../../src/core/estimator/simulate'
import {
  estimateInputsSchema,
  parseEstimateGoal,
  type EstimateInputs,
} from '../../src/shared/estimate'

const AS_OF = '2026-10-10T12:00:00.000Z'
const PLAN = `## 6. Milestones

### M112 — Widget work (2026-10-10)

**Status 2026-10-10: building.**

- **Goal.** Ship widgets.
- **Depends on.** Nothing new.
- **Gates.** The full gate.

| Lane | Items | Files it owns | Starts | Rig | Hours |
| ---- | ----- | ------------- | ------ | --- | ----- |
| 0 | all | \`src/a.ts\` | First | Kubuntu | 8 |
| Q | 1 | \`src/q.ts\` | after 0 | Kubuntu | 5 |
| U | 2 | \`src/u.ts\` | after Q | Kubuntu | 3 |
`

/** A milestone from plan text to a simulated forecast, twice for determinism. */
async function forecast(): Promise<{
  inputs: EstimateInputs
  p50: string
  p90: string
  schedule: readonly string[]
  criticalPath: readonly string[]
  unknownLimits: readonly string[]
}> {
  const goal = parseEstimateGoal('M112')
  if (goal === undefined) throw new Error('unparseable goal')
  const snapshot = buildPlanSnapshot(PLAN, goal, AS_OF, {
    branches: [{ name: 'm112/0', merged: true }],
  })
  const lanes = await resolveEstimateGoal(goal, AS_OF, {
    snapshot: () => Promise.resolve(snapshot),
  })
  const fleet = { ...localFleet(lanes), asOf: AS_OF }
  const inputs = estimateInputsSchema.parse({
    request: { goal, asOf: AS_OF, fleet: 'current', optimize: 'cost' },
    lanes,
    fleet,
    history: [],
  })
  const zero = {
    status: 'known' as const,
    value: 0,
    basis: 'assumption' as const,
    samples: 0,
    uncertainty: { kind: 'interval' as const, lower: 0, upper: 0 },
  }
  const port: EstimateDurationPort = {
    model: (lane, machineClassId) => ({
      kind: 'lognormal',
      calibration: fitCalibration([], lane.kind, machineClassId, AS_OF).calibration,
      reviewHours: zero,
      redesignHours: zero,
    }),
  }
  const simulation = simulateEstimate(inputs, port)
  return {
    inputs,
    p50: simulation.p50,
    p90: simulation.p90,
    schedule: simulation.schedule.map((entry) => entry.laneId),
    criticalPath: simulation.criticalPath,
    unknownLimits: simulation.unknownLimits,
  }
}

describe('M117 plan snapshot to forecast', () => {
  it('forecasts a milestone from plan text with disclosed unknown limits', async () => {
    const result = await forecast()
    expect(result.schedule).toEqual(['M112:Q', 'M112:U'])
    expect(result.criticalPath).toEqual(['M112:Q', 'M112:U'])
    expect(Date.parse(result.p90)).toBeGreaterThanOrEqual(Date.parse(result.p50))
    expect(Date.parse(result.p50)).toBeGreaterThanOrEqual(Date.parse(AS_OF))
    expect(result.unknownLimits.length).toBeGreaterThan(0)
    expect(result.inputs.lanes).toHaveLength(3)
  })

  it('reproduces the same forecast bytes on a second run', async () => {
    const first = await forecast()
    const second = await forecast()
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})
