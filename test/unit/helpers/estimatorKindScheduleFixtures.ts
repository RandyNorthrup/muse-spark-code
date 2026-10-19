import {
  fleetSnapshotSchema,
  type EstimateLane,
  type FleetSnapshot,
} from '../../../src/shared/estimate'
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

/** Exact durations and fitted parameters below are test assumptions. */
