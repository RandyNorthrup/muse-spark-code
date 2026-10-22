import {
  fleetSnapshotSchema,
  type EstimateInputs,
  type EstimateLane,
  type FleetSnapshot,
} from '../../../src/shared/estimate'
import type { EstimateDurationPort } from '../../../src/core/estimator/simulate'
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

/**
The smallest schema-valid fleet the scheduler accepts: one machine with
core capacity, one role, one account and the requested slots. Values are
arbitrary capacity labels; the scheduling verdicts come from the real
`prepareEstimateSchedule`.
*/
/** One schema-valid fixture machine: the disk, core and cap labels are
arbitrary; only the id, class and slot count vary between suites. */
export function fleetMachine(id: string, classId: string, slots: number) {
  return {
    id,
    classId,
    source: 'node',
    os: 'linux',
    architecture: 'x64',
    cores: 4,
    ramGiB: 8,
    disks: [
      {
        status: 'known',
        volumeId: 'primary',
        roles: ['workspace', 'temp', 'state'],
        totalBytes: 53_687_091_200,
        freeBytes: 10_737_418_240,
        floorBytes: 5_368_709_120,
        headroomBytes: 5_368_709_120,
      },
    ],
    governorSlots: slots,
    capacityByKind: [{ kind: 'core', slots }],
    caps: { slots, cpuPercent: 50, memoryPercent: 50 },
  }
}

export function scheduleFleet(slots = 2): FleetSnapshot {
  return fleetSnapshotSchema.parse({
    asOf: '2026-10-06T12:00:00.000Z',
    machines: [fleetMachine('schedule-machine', 'linux-x64-schedule', slots)],
    roles: [{ id: 'schedule-role', laneKinds: ['core'] }],
    accounts: [{ id: 'schedule-account', providerId: 'schedule-provider', requestsPerMinute: 10 }],
    slots: Array.from({ length: slots }, (_, index) => ({
      id: `slot-${String(index)}`,
      machineId: 'schedule-machine',
      roleId: 'schedule-role',
      accountId: 'schedule-account',
    })),
    ci: [],
  })
}

/** A pool admitting one lane kind on the schedule machine: a pricing
fixture, not a policy statement about the lane. */
export function schedulePool(laneKind: string, slots = 1): FleetSnapshot {
  const base = scheduleFleet()
  return fleetSnapshotSchema.parse({
    ...base,
    roles: [{ id: 'schedule-role', laneKinds: [laneKind] }],
    machines: [
      {
        ...fleetMachine('schedule-machine', 'linux-x64-schedule', 2),
        id: 'schedule-machine',
        capacityByKind: [{ kind: laneKind, slots }],
      },
    ],
  })
}

/** Exact durations and fitted parameters below are test assumptions. */
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

/** Exact durations below are test assumptions: every lane runs its estimate. */
export const fixedDurationPort: EstimateDurationPort = {
  model: (lane) => ({
    kind: 'fixed',
    hours: amount(lane.estimatedHours),
  }),
}

/** An uncalibrated prior: zero samples, so the band stays assumption-based. */
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
