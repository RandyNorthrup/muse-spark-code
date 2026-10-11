// M117 C-M117-3: the fleet binding applies M107's caps, M108's account rows
// and CI concurrency onto this machine's measured fleet, fail-closed.
// Acceptance 3 runs through the real fleet port, not engine fakes.
// Repository default timeout; no skips.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findEstimateBottleneck } from '../../src/core/estimator/bottleneck'
import { canEstimateMachineRun, prepareEstimateSchedule } from '../../src/core/estimator/schedule'
import { estimatorSourcePorts, fleetFromHost } from '../../src/host/estimator/localFleet'
import { applyFleetBinding, type FleetBindingIo } from '../../src/host/estimator/fleetBinding'
import { fleetSnapshotSchema } from '../../src/shared/estimate'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { chainLanes } from './helpers/estimator/fixtures'
import { amount, scheduleLane } from './helpers/estimatorScheduleFixtures'

const AS_OF = '2026-10-06T12:00:00.000Z'
const HOST = { platform: 'linux', arch: 'x64', cores: 8, ramGiB: 16 } as const

beforeEach(() => {
  setUiText(EN, BASE_LOCALE)
})
afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

const portsFor = (fleetIo?: FleetBindingIo) =>
  estimatorSourcePorts(
    () => ({ enabled: false, networkAllowed: false, maxAgeMs: 0, catalogUrls: [] }),
    () => Promise.resolve([]),
    fleetIo,
  )

const accountRows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `account-${String(index)}`,
    providerId: 'meta',
    requestsPerMinute: 60,
  }))

const boundFleet = async (fleetIo?: FleetBindingIo) => {
  const lanes = [scheduleLane('A'), scheduleLane('B')]
  return {
    lanes,
    fleet: fleetSnapshotSchema.parse(await portsFor(fleetIo).fleet(lanes, AS_OF)),
  }
}

describe('M117 fleet binding', () => {
  it('keeps the measured fleet byte-identical without readers', () => {
    const base = fleetFromHost({ ...HOST }, chainLanes(), AS_OF)
    expect(applyFleetBinding(base)).toEqual(base)
  })
  it('stamps the request asOf through the real fleet and candidatePool ports', async () => {
    const lanes = [scheduleLane('A'), scheduleLane('B')]
    const ports = portsFor()
    const fleet = fleetSnapshotSchema.parse(await ports.fleet(lanes, AS_OF))
    const pool = fleetSnapshotSchema.parse(await ports.candidatePool(lanes, AS_OF))
    expect(fleet.asOf).toBe(AS_OF)
    expect(pool).toEqual(fleet)
    expect(fleet.machines).toHaveLength(1)
    expect(fleet.ci).toEqual([])
  })
  it("applies M107's configured caps and refuses ceilings it cannot honour", () => {
    const base = fleetFromHost({ ...HOST }, chainLanes(), AS_OF)
    const capped = applyFleetBinding(base, {
      capacityCaps: () => ({ cpuMaxPercent: 80, memoryMaxPercent: 70 }),
    })
    expect(capped.machines[0]).toMatchObject({
      governorSlots: 1,
      caps: { slots: 1, cpuPercent: 80, memoryPercent: 70 },
    })
    for (const caps of [
      { cpuMaxPercent: -1, memoryMaxPercent: 70 },
      { cpuMaxPercent: 80, memoryMaxPercent: 101 },
    ])
      expect(() => applyFleetBinding(base, { capacityCaps: () => caps })).toThrow(
        /fleet-caps-invalid/,
      )
  })
  it("binds M108's single account row and refuses an ambiguous choice", () => {
    const base = fleetFromHost({ ...HOST }, chainLanes(), AS_OF)
    const bound = applyFleetBinding(base, {
      accounts: () => [
        {
          id: 'work',
          providerId: 'meta',
          requestsPerMinute: 60,
          usageLimits: [
            {
              id: 'daily',
              kind: 'calendar',
              period: 'day',
              timeZone: 'UTC',
              unit: 'requests',
              remaining: 100,
              allowance: 1000,
              resetsAt: '2026-10-07T00:00:00.000Z',
            },
          ],
        },
      ],
    })
    expect(bound.accounts).toHaveLength(1)
    expect(bound.accounts[0]).toMatchObject({ id: 'work', providerId: 'meta' })
    expect(bound.slots.map((slot) => slot.accountId)).toEqual(['work'])
    expect(() => applyFleetBinding(base, { accounts: () => accountRows(2) })).toThrow(
      /fleet-accounts-ambiguous/,
    )
    expect(() => applyFleetBinding(base, { accounts: () => accountRows(0) })).toThrow(
      /fleet-accounts-ambiguous/,
    )
  })
  it('carries CI concurrency rows and refuses a corrupt one', () => {
    const base = fleetFromHost({ ...HOST }, chainLanes(), AS_OF)
    const bound = applyFleetBinding(base, {
      ci: () => [
        {
          id: 'ci-1',
          concurrentJobs: 2,
          occupiedJobs: 1,
          minutesRemaining: 120,
          periodEndsAt: '2026-11-01T00:00:00.000Z',
        },
      ],
    })
    expect(bound.ci).toEqual([
      {
        id: 'ci-1',
        concurrentJobs: 2,
        occupiedJobs: 1,
        minutesRemaining: 120,
        periodEndsAt: '2026-11-01T00:00:00.000Z',
      },
    ])
    expect(() =>
      applyFleetBinding(base, { ci: () => [{ id: 'ci-1', concurrentJobs: 1, occupiedJobs: 2 }] }),
    ).toThrow()
  })
  it('leaves paired-device and node rows absent with their true reason', async () => {
    const { fleet } = await boundFleet()
    expect(fleet.machines.every((machine) => machine.source === 'local')).toBe(true)
    const gpuLane = {
      ...scheduleLane('GPU'),
      affinity: { ...scheduleLane('GPU').affinity, gpuRequired: true },
    }
    const deviceLane = {
      ...scheduleLane('DEV'),
      affinity: { ...scheduleLane('DEV').affinity, machineClassIds: ['device-x'] },
    }
    for (const lane of [gpuLane, deviceLane])
      expect(fleet.machines.some((machine) => canEstimateMachineRun(lane, machine))).toBe(false)
  })
  it('names machines through the real fleet port when one serial row binds', async () => {
    const { lanes, fleet } = await boundFleet()
    expect(findEstimateBottleneck(lanes, fleet)).toMatchObject({ kind: 'machines' })
  })
  it('fails closed through the real fleet port when CI is over-committed', async () => {
    // One serial slot couples every other contention, so the row binds by
    // refusing work past the limit (with its lane) instead of by outranking
    // slots in the bottleneck card.
    const lanes = [
      {
        ...scheduleLane('A'),
        resources: { ...scheduleLane('A').resources, ciId: 'ci-1', ciJobs: amount(1) },
      },
    ]
    const overCommitted = fleetSnapshotSchema.parse(
      await portsFor({ ci: () => [{ id: 'ci-1', concurrentJobs: 0, occupiedJobs: 0 }] }).fleet(
        lanes,
        AS_OF,
      ),
    )
    expect(() => prepareEstimateSchedule(lanes, overCommitted).run(undefined)).toThrow(
      /unschedulable:A/,
    )
    const fitting = fleetSnapshotSchema.parse(
      await portsFor({ ci: () => [{ id: 'ci-1', concurrentJobs: 1, occupiedJobs: 0 }] }).fleet(
        lanes,
        AS_OF,
      ),
    )
    expect(prepareEstimateSchedule(lanes, fitting).run(undefined).finishHours).toBe(1)
  })
  it("fails closed through the real fleet port when M108's rate binds", async () => {
    const lanes = [scheduleLane('A')]
    const bound = fleetSnapshotSchema.parse(
      await portsFor({
        accounts: () => [{ id: 'local', providerId: 'local', requestsPerMinute: 0.5 / 60 }],
      }).fleet(lanes, AS_OF),
    )
    expect(() => prepareEstimateSchedule(lanes, bound).run(undefined)).toThrow(/unschedulable:A/)
    const { fleet: budgeted } = await boundFleet()
    expect(prepareEstimateSchedule(lanes, budgeted).run(undefined).finishHours).toBe(1)
  })
})
