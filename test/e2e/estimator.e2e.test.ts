import { describe, expect, it } from 'vitest'
import dags from '../fixtures/estimator/dags.json'
import { estimateLaneSchema, parseEstimateGoal } from '../../src/shared/estimate'
import { resolveEstimateGoal, type EstimateGoalSnapshot } from '../../src/core/estimator/goal'
import { prepareEstimateSchedule } from '../../src/core/estimator/schedule'
import { EstimateWaveStarter } from '../../src/core/estimator/provision/start'
import { FakeEstimateStart, ESTIMATOR_AS_OF } from '../unit/helpers/estimator/fakes'
import { scheduleFleet, simulationInputs } from '../unit/helpers/estimatorScheduleFixtures'

/** Fake-only application source: the M113 parser/board bindings are absent.
 * No external process, model, provider or paid resource is used.
 */
function fixturePlan(): EstimateGoalSnapshot {
  const chain = dags.find((fixture) => fixture.name === 'chain')
  if (!chain) throw new Error('Missing chain fixture')
  const lanes = chain.lanes.map((input, index) => ({
    lane: estimateLaneSchema.parse({
      ...input,
      id: `M117:${input.id}`,
      kind: index === 0 ? 'contracts' : input.kind,
      dependencies: input.dependencies.map((id) => `M117:${id}`),
    }),
  }))
  return {
    asOf: ESTIMATOR_AS_OF,
    lanes,
    milestones: [{ id: 'M117', laneIds: lanes.map(({ lane }) => lane.id) }],
    pullRequests: [],
    issues: [],
    releases: [],
    rigs: [],
  }
}

describe('M117 fixture plan to schedule to audited first-wave submission', () => {
  it('resolves the milestone, schedules the chain and submits contracts before later waves', async () => {
    const plan = fixturePlan()
    const lanes = await resolveEstimateGoal(parseEstimateGoal('M117'), plan.asOf, {
      snapshot: () => Promise.resolve(plan),
    })
    const fleet = scheduleFleet(1)
    for (const machine of fleet.machines)
      machine.capacityByKind.push({ kind: 'contracts', slots: 1 })
    const forecast = prepareEstimateSchedule(lanes, fleet).run()
    expect(forecast.schedule.map((entry) => entry.laneId)).toEqual(['M117:A', 'M117:B', 'M117:C'])
    expect(forecast.criticalPath).toEqual(['M117:A', 'M117:B', 'M117:C'])
    const board = new FakeEstimateStart()
    const starter = new EstimateWaveStarter(board)
    const input = simulationInputs(lanes, fleet)
    expect(await starter.start(input)).toEqual(['M117:A'])
    expect(board.audits).toEqual([['M117:A']])
    for (const lane of input.lanes) if (lane.id === 'M117:A') lane.state = 'merged'
    expect(await starter.start(input)).toEqual(['M117:B'])
    expect(board.starts).toEqual([['M117:A'], ['M117:B']])
  })

  it('does not submit a fixture lane when the prerequisite audit has no merge receipt', async () => {
    const plan = fixturePlan()
    const lanes = await resolveEstimateGoal(parseEstimateGoal('M117'), plan.asOf, {
      snapshot: () => Promise.resolve(plan),
    })
    const fleet = scheduleFleet(1)
    for (const machine of fleet.machines)
      machine.capacityByKind.push({ kind: 'contracts', slots: 1 })
    const board = new FakeEstimateStart(['M113:0'])
    await expect(
      new EstimateWaveStarter(board).start(simulationInputs(lanes, fleet)),
    ).rejects.toThrow('Contracts must be reviewed')
    expect(board.starts).toEqual([])
  })
})
