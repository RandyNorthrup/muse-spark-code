import { type EstimateLane, type FleetSnapshot } from '../../../src/shared/estimate'
import { fakeFleet } from './estimator/fakes'
import { goalLane } from './estimatorGoalFixtures'
import { type EstimateInputs } from '../../../src/shared/estimate'
import { type EstimateDurationPort } from '../../../src/core/estimator/simulate'
import { ESTIMATOR_AS_OF } from './estimator/fakes'

export const amount = (
  value: number,
): Extract<EstimateLane['resources']['ciMinutes'], { status: 'known' }> => ({
  status: 'known',
  value,
  basis: 'assumption',
  samples: 0,
  uncertainty: { kind: 'interval', lower: value, upper: value },
})

export function scheduleLane(id: string, changes: Partial<EstimateLane> = {}): EstimateLane {
  const lane = goalLane(id, changes)
  lane.resources.disk = [{ role: 'workspace', peakBytes: amount(0), steadyBytes: amount(0) }]
  return lane
}

export function scheduleFleet(slots = 2): FleetSnapshot {
  const fleet = fakeFleet()
  fleet.machines = [fleet.machines[0]!]
  const machine = fleet.machines[0]!
  machine.governorSlots = slots
  machine.caps.slots = slots
  machine.capacityByKind = [{ kind: 'core', slots }]
  fleet.slots = Array.from({ length: slots }, (_, index) => ({
    id: `slot-${String(index)}`,
    machineId: machine.id,
    roleId: fleet.roles[0]!.id,
    accountId: fleet.accounts[0]!.id,
  }))
  return fleet
}

export function simulationInputs(
  lanes = [scheduleLane('A')],
  fleet = scheduleFleet(),
): EstimateInputs {
  return {
    request: {
      goal: { kind: 'milestone', milestoneId: 'M117' },
      asOf: fleet.asOf,
      fleet: 'current',
      optimize: 'cost',
      seed: 'golden-schedule',
    },
    lanes,
    fleet,
    history: [],
  }
}

/** Exact durations and fitted parameters below are test assumptions. */
export const fixedDurationPort: EstimateDurationPort = {
  model: (lane) => ({
    kind: 'fixed',
    hours: amount(
      lane.state === 'running'
        ? Math.max(lane.minimumRemainingHours, lane.estimatedHours - lane.elapsedAgentHours)
        : lane.estimatedHours,
    ),
  }),
}

export const lognormalPort: EstimateDurationPort = {
  model: (lane, machineClassId) => ({
    kind: 'lognormal',
    calibration: {
      kind: lane.kind,
      machineClassId,
      samples: 0,
      basis: 'uncalibratedPrior',
      mu: 0,
      sigma: 0.5,
      reviewRoundRate: 0.2,
      redesignRisk: 0.1,
    },
    reviewHours: amount(0.25),
    redesignHours: amount(2),
  }),
}

export function deterministicSimulationInputs(): EstimateInputs {
  const inputs = simulationInputs([scheduleLane('A'), scheduleLane('B', { dependencies: ['A'] })])
  inputs.request.asOf = ESTIMATOR_AS_OF
  return inputs
}
