import { type EstimateLane, type FleetSnapshot } from '../../../src/shared/estimate'
import { fakeFleet } from './estimator/kindFakes'
import { goalLane } from './estimatorKindGoalFixtures'
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

/** Exact durations and fitted parameters below are test assumptions. */
