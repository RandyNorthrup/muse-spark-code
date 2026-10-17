import { fleetSnapshotSchema, type FleetSnapshot } from '../../../../src/shared/estimate'
import type { PlanSnapshotSourceIo } from '../../../../src/host/estimator/planSnapshotSource'

export const ESTIMATOR_AS_OF = '2026-10-06T12:00:00.000Z'

/** PLAN.md plus git and `gh` outputs for plan-source tests. */
export function fakePlanSourceIo(
  plan: string,
  pulls: string,
  mergedBranches: string,
  overrides: Partial<PlanSnapshotSourceIo> = {},
): PlanSnapshotSourceIo {
  return {
    readPlanFile: () => Promise.resolve(plan),
    runGit: (args) => {
      if (args.includes('symbolic-ref')) return Promise.resolve('refs/remotes/origin/main\n')
      return Promise.resolve(args.includes('--merged') ? mergedBranches : 'm112/0\nm112/q\n')
    },
    runGh: () => Promise.resolve(pulls),
    ...overrides,
  }
}

/** Fictional aliases and capacities: no host inspection, secrets, or network. */
export function fakeFleet(): FleetSnapshot {
  const disk = {
    status: 'known',
    volumeId: 'primary',
    roles: ['workspace', 'temp', 'state'],
    totalBytes: 107_374_182_400,
    freeBytes: 23_622_320_128,
    floorBytes: 10_737_418_240,
    headroomBytes: 12_884_901_888,
  }
  return fleetSnapshotSchema.parse({
    asOf: ESTIMATOR_AS_OF,
    machines: [
      {
        id: 'linux',
        classId: 'linux-x64-builder',
        source: 'node',
        os: 'linux',
        architecture: 'x64',
        cores: 8,
        ramGiB: 16,
        disks: [disk],
        governorSlots: 2,
        capacityByKind: [{ kind: 'core', slots: 2 }],
        caps: { slots: 2, cpuPercent: 80, memoryPercent: 80 },
      },
      {
        id: 'mac',
        classId: 'macos-arm64-builder',
        source: 'local',
        os: 'macos',
        architecture: 'arm64',
        cores: 8,
        ramGiB: 16,
        disks: [disk],
        governorSlots: 1,
        capacityByKind: [
          { kind: 'core', slots: 1 },
          { kind: 'ui', slots: 1 },
        ],
        caps: { slots: 1, cpuPercent: 80, memoryPercent: 80 },
      },
      {
        id: 'windows',
        classId: 'windows-x64-builder',
        source: 'device',
        os: 'windows',
        architecture: 'x64',
        cores: 8,
        ramGiB: 16,
        disks: [disk],
        governorSlots: 1,
        capacityByKind: [{ kind: 'host', slots: 1 }],
        caps: { slots: 1, cpuPercent: 80, memoryPercent: 80 },
      },
    ],
    roles: [
      { id: 'builder', laneKinds: ['contracts', 'core', 'ui', 'host', 'tests', 'integration'] },
    ],
    accounts: [
      {
        id: 'account-1',
        providerId: 'test-provider',
        requestsPerMinute: 10,
        tokensPerMinute: 10_000,
        usageLimits: [
          {
            id: 'daily',
            kind: 'calendar',
            period: 'day',
            timeZone: 'UTC',
            unit: 'requests',
            remaining: 1000,
            allowance: 1000,
            resetsAt: '2026-10-07T00:00:00.000Z',
          },
          {
            id: 'weekly',
            kind: 'calendar',
            period: 'week',
            timeZone: 'UTC',
            unit: 'requests',
            remaining: 5000,
            allowance: 5000,
            resetsAt: '2026-10-12T00:00:00.000Z',
          },
        ],
      },
    ],
    slots: [
      { id: 'linux-1', machineId: 'linux', roleId: 'builder', accountId: 'account-1' },
      { id: 'linux-2', machineId: 'linux', roleId: 'builder', accountId: 'account-1' },
      { id: 'mac-1', machineId: 'mac', roleId: 'builder', accountId: 'account-1' },
      { id: 'windows-1', machineId: 'windows', roleId: 'builder', accountId: 'account-1' },
    ],
    ci: [
      {
        id: 'ci-1',
        concurrentJobs: 2,
        occupiedJobs: 0,
        minutesRemaining: 120,
        periodEndsAt: '2026-11-01T00:00:00.000Z',
      },
    ],
  })
}
