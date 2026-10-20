import { describe, expect, it } from 'vitest'
import { buildPlanSnapshot } from '../../src/core/estimator/planSnapshot'
import { fitCalibration } from '../../src/core/estimator/calibration/fit'
import { compareEstimateIds, resolveEstimateGoal } from '../../src/core/estimator/goal'
import { fleetFromHost } from '../../src/host/estimator/localFleet'
import { simulateEstimate, type EstimateDurationPort } from '../../src/core/estimator/simulate'
import {
  estimateInputsSchema,
  parseEstimateGoal,
  type EstimateInputs,
} from '../../src/shared/estimate'
import repository from '../fixtures/estimator/repository-history.json'

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

/** A goal from plan text to a simulated forecast, twice for determinism. */
async function forecastPlan(
  planText: string,
  goalText: string,
  evidence?: { branches: { name: string; merged: boolean }[] },
  seed?: string,
): Promise<{
  inputs: EstimateInputs
  p50: string
  p90: string
  schedule: readonly string[]
  criticalPath: readonly string[]
  unknownLimits: readonly string[]
}> {
  const goal = parseEstimateGoal(goalText)
  if (goal === undefined) throw new Error('unparseable goal')
  const snapshot = buildPlanSnapshot(planText, goal, AS_OF, evidence ?? { branches: [] })
  const lanes = await resolveEstimateGoal(goal, AS_OF, {
    snapshot: () => Promise.resolve(snapshot),
  })
  // One clock: the fleet is stamped with the request's asOf, so the inputs'
  // fleet/request equality holds without overwriting timestamps in-test.
  const fleet = fleetFromHost({ platform: 'linux', arch: 'x64', cores: 4, ramGiB: 8 }, lanes, AS_OF)
  const inputs = estimateInputsSchema.parse({
    // An explicit seed keeps the golden byte-identical on every machine: the
    // default seed fingerprints the measured local fleet.
    request: { goal, asOf: AS_OF, fleet: 'current', optimize: 'cost', ...(seed && { seed }) },
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

/** The M103 lane table projected from the captured repository history: lane
ids and dependencies come from the fixture; hours are fixed test weights
(the original plan carries none, so the estimate would refuse without
them). Lane A carries the heaviest estimate, matching the DAG golden's
critical path through it. */
function historyPlan(mid = 'M103'): string {
  const records = repository.lanes.filter((lane) => lane.laneId.startsWith(`${mid}:`))
  const rows = records.map((record) => {
    const short = record.laneId.split(':', 2)[1] ?? record.laneId
    const deps = record.dependencies.map((id) => id.split(':', 2)[1] ?? id)
    const starts =
      deps.length === 0
        ? 'First'
        : `after ${deps.slice(0, -1).join(', ')}${deps.length > 1 ? ' and ' : ''}${deps.at(-1) ?? ''}`
    const hours = short === 'A' ? 4 : 2
    return `| ${short} | 1 | \`src/${mid.toLowerCase()}/${short.toLowerCase()}.ts\` | ${starts} | Kubuntu | ${String(hours)} |`
  })
  return `## 6. Milestones

### ${mid} — Captured work (2026-10-06)

**Status 2026-10-06: built.**

- **Goal.** Ship captured work.
- **Depends on.** Nothing new.
- **Gates.** The full gate.

| Lane | Items | Files it owns | Starts | Rig | Hours |
| ---- | ----- | ------------- | ------ | --- | ----- |
${rows.join('\n')}
`
}

describe('M117 plan snapshot to forecast', () => {
  it('F13 forecasts a milestone from plan text with disclosed unknown limits', async () => {
    const result = await forecastPlan(PLAN, 'M112', {
      branches: [{ name: 'm112/0', merged: true }],
    })
    expect(result.schedule).toEqual(['M112:Q', 'M112:U'])
    expect(result.criticalPath).toEqual(['M112:Q', 'M112:U'])
    expect(Date.parse(result.p90)).toBeGreaterThanOrEqual(Date.parse(result.p50))
    expect(Date.parse(result.p50)).toBeGreaterThanOrEqual(Date.parse(AS_OF))
    expect(result.unknownLimits.length).toBeGreaterThan(0)
    expect(result.inputs.lanes).toHaveLength(3)
  })

  it('reproduces the same forecast bytes on a second run', async () => {
    const first = await forecastPlan(PLAN, 'M112', {
      branches: [{ name: 'm112/0', merged: true }],
    })
    const second = await forecastPlan(PLAN, 'M112', {
      branches: [{ name: 'm112/0', merged: true }],
    })
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('goldens the historical M103 projection to exact forecast dates', async () => {
    const first = await forecastPlan(historyPlan(), 'M103', { branches: [] }, 'm103-golden')
    const second = await forecastPlan(historyPlan(), 'M103', { branches: [] }, 'm103-golden')
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    // Lane A carries the heaviest estimate (the DAG golden pins the
    // estimate-level critical path through it); the seeded simulation draws
    // below pick U instead, and the golden pins that exact outcome.
    expect(first.criticalPath).toEqual(['M103:0', 'M103:U', 'M103:W', 'M103:E'])
    expect(first.inputs.lanes).toHaveLength(14)
    expect(first.p50).toBe('2026-10-11T21:40:26.466Z')
    expect(first.p90).toBe('2026-10-12T04:50:46.691Z')
    expect(first.schedule).toEqual([
      'M103:0',
      'M103:I',
      'M103:U',
      'M103:D',
      'M103:A',
      'M103:P',
      'M103:T',
      'M103:S',
      'M103:M',
      'M103:R',
      'M103:V',
      'M103:G',
      'M103:W',
      'M103:E',
    ])
  })
  it('forecasts a completed hour-less goal without rig or capacity placement', async () => {
    const plan = PLAN.replace('First | Kubuntu | 8', 'First | Buildertown | —')
    const result = await forecastPlan(
      plan,
      'M112:0',
      { branches: [{ name: 'm112/0', merged: true }] },
      'completed-golden',
    )
    expect(result.p50).toBe(AS_OF)
    expect(result.p90).toBe(AS_OF)
    expect(result.schedule).toEqual([])
    expect(result.inputs.lanes[0]?.id).toBe('M112:0')
  })

  it('F14 goldens the historical M104 projection to exact forecast dates', async () => {
    const first = await forecastPlan(historyPlan('M104'), 'M104', { branches: [] }, 'm104-golden')
    const second = await forecastPlan(historyPlan('M104'), 'M104', { branches: [] }, 'm104-golden')
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(first.inputs.lanes.map((lane) => lane.id)).toEqual(
      repository.lanes
        .filter((lane) => lane.laneId.startsWith('M104:'))
        .map((lane) => lane.laneId)
        .toSorted(compareEstimateIds),
    )
    expect({
      p50: first.p50,
      p90: first.p90,
      schedule: first.schedule,
      criticalPath: first.criticalPath,
    }).toEqual({
      p50: '2026-10-11T14:44:25.719Z',
      p90: '2026-10-11T21:13:17.064Z',
      criticalPath: ['M104:0', 'M104:B'],
      schedule: [
        'M104:0',
        'M104:B',
        'M104:C',
        'M104:A',
        'M104:G',
        'M104:H',
        'M104:D',
        'M104:I',
        'M104:F',
        'M104:E',
        'M104:J',
      ],
    })
  })
})
