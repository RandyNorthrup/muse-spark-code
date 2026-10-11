// M117 C-M117-3R2: the fleet binding applies M107's caps (ceilings shape
// admission, not just percent fields), M108's ACTIVE account row and CI
// concurrency onto this machine's measured fleet, fail-closed with named
// details. Both production assemblies (extension, headless) pass their real
// settings through the tested source helpers; the selection and translation
// run against the real store/reader shapes. Acceptance 3 runs through the
// real fleet port, not engine fakes.
// Repository default timeout; no skips.
import { beforeEach, describe, expect, it } from 'vitest'
import { findEstimateBottleneck } from '../../src/core/estimator/bottleneck'
import { canEstimateMachineRun, prepareEstimateSchedule } from '../../src/core/estimator/schedule'
import { estimatorSourcePorts, fleetFromHost } from '../../src/host/estimator/localFleet'
import {
  applyFleetBinding,
  extensionFleetSources,
  fleetAccountFromLimits,
  fleetIoFromSources,
  fleetSlotsForCaps,
  headlessFleetSources,
  selectFleetAccount,
  type FleetBindingIo,
  type FleetSources,
} from '../../src/host/estimator/fleetBinding'
import { fleetSnapshotSchema } from '../../src/shared/estimate'
import {
  RESOURCE_CPU_DEFAULT_PERCENT,
  RESOURCE_MEMORY_DEFAULT_PERCENT,
} from '../../src/shared/constants'
import type { ResourceSettingsReader } from '../../src/shared/resources'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { chainLanes } from './helpers/estimator/fixtures'
import { amount, scheduleLane } from './helpers/estimatorScheduleFixtures'

const AS_OF = '2026-10-06T12:00:00.000Z'
const NOW_MS = Date.parse(AS_OF)
const HOST = { platform: 'linux', arch: 'x64', cores: 8, ramGiB: 16 } as const

beforeEach(() => {
  setUiText(EN, BASE_LOCALE)
})

const portsFor = (fleetIo?: FleetBindingIo) =>
  estimatorSourcePorts(
    () => ({ enabled: false, networkAllowed: false, maxAgeMs: 0, catalogUrls: [] }),
    () => Promise.resolve([]),
    fleetIo,
  )

const boundFleet = async (fleetIo?: FleetBindingIo) => {
  const lanes = [scheduleLane('A'), scheduleLane('B')]
  return {
    lanes,
    fleet: fleetSnapshotSchema.parse(await portsFor(fleetIo).fleet(lanes, AS_OF)),
  }
}

describe('M117 fleet binding', () => {
  it('keeps the measured fleet byte-identical without readers', async () => {
    const base = fleetFromHost({ ...HOST }, chainLanes(), AS_OF)
    expect(await applyFleetBinding(base)).toEqual(base)
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
  it('derives forecast slots from the ceilings, never a hard-coded 1', () => {
    expect(fleetSlotsForCaps(8, 100, 100)).toBe(8)
    expect(fleetSlotsForCaps(8, 85, 90)).toBe(7)
    expect(fleetSlotsForCaps(8, 1, 1)).toBe(1)
    expect(fleetSlotsForCaps(8, 0, 0)).toBe(0)
    expect(() => fleetSlotsForCaps(8, -1, 70)).toThrow(/fleet-caps-invalid/)
    expect(() => fleetSlotsForCaps(8, 80, 101)).toThrow(/fleet-caps-invalid/)
    expect(() => fleetSlotsForCaps(0, 80, 70)).toThrow(/fleet-caps-invalid/)
  })
  it("applies M107's configured caps and refuses ceilings it cannot honour", async () => {
    const base = fleetFromHost({ ...HOST }, chainLanes(), AS_OF)
    const capped = await applyFleetBinding(base, {
      capacityCaps: () => ({ cpuMaxPercent: 80, memoryMaxPercent: 70 }),
    })
    expect(capped.machines[0]).toMatchObject({
      governorSlots: 6,
      caps: { slots: 6, cpuPercent: 80, memoryPercent: 70 },
    })
    expect(capped.machines[0]?.capacityByKind).toEqual([
      { kind: 'contracts', slots: 6 },
      { kind: 'core', slots: 6 },
    ])
    expect(capped.slots).toHaveLength(6)
    for (const caps of [
      { cpuMaxPercent: -1, memoryMaxPercent: 70 },
      { cpuMaxPercent: 80, memoryMaxPercent: 101 },
    ])
      await expect(applyFleetBinding(base, { capacityCaps: () => caps })).rejects.toThrow(
        /fleet-caps-invalid/,
      )
  })
  it('finishes the same lanes at a different time under 1/1 than 100/100', async () => {
    const lanes = [scheduleLane('A'), scheduleLane('B')]
    const tight = await applyFleetBinding(fleetFromHost({ ...HOST }, lanes, AS_OF), {
      capacityCaps: () => ({ cpuMaxPercent: 1, memoryMaxPercent: 1 }),
    })
    const ample = await applyFleetBinding(fleetFromHost({ ...HOST }, lanes, AS_OF), {
      capacityCaps: () => ({ cpuMaxPercent: 100, memoryMaxPercent: 100 }),
    })
    expect(tight.machines[0]?.governorSlots).toBe(1)
    expect(ample.machines[0]?.governorSlots).toBe(8)
    expect(prepareEstimateSchedule(lanes, tight).run(undefined).finishHours).toBe(2)
    expect(prepareEstimateSchedule(lanes, ample).run(undefined).finishHours).toBe(1)
  })
  it("binds M108's active row and keeps the measured row without one", async () => {
    const base = fleetFromHost({ ...HOST }, chainLanes(), AS_OF)
    const bound = await applyFleetBinding(base, {
      accounts: () => ({
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
      }),
    })
    expect(bound.accounts).toHaveLength(1)
    expect(bound.accounts[0]).toMatchObject({ id: 'work', providerId: 'meta' })
    expect(bound.slots.map((slot) => slot.accountId)).toEqual(['work'])
    // Zero accounts, or no usable limits, keep the measured row: a normal
    // multi-account user is never met with an 'ambiguous' refusal.
    expect(await applyFleetBinding(base, { accounts: () => undefined })).toEqual(base)
  })
  it('refuses a corrupt account row with a named detail, never a raw $ZodError', async () => {
    const base = fleetFromHost({ ...HOST }, chainLanes(), AS_OF)
    await expect(
      applyFleetBinding(base, {
        accounts: () => ({ id: '!!!', providerId: 'meta', requestsPerMinute: 60 }),
      }),
    ).rejects.toThrow(/Estimate failed: fleet-account-invalid/)
    const stripped = fleetSnapshotSchema.parse({
      ...base,
      accounts: [],
      slots: [],
    })
    await expect(
      applyFleetBinding(stripped, { accounts: () => ({ id: 'work', providerId: 'meta' }) }),
    ).rejects.toThrow(/Estimate failed: fleet-account-invalid/)
  })
  it('carries CI concurrency rows and refuses a corrupt one with a named detail', async () => {
    const base = fleetFromHost({ ...HOST }, chainLanes(), AS_OF)
    const bound = await applyFleetBinding(base, {
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
    await expect(
      applyFleetBinding(base, { ci: () => [{ id: 'ci-1', concurrentJobs: 1, occupiedJobs: 2 }] }),
    ).rejects.toThrow(/Estimate failed: fleet-ci-invalid/)
  })
  it('selects the active account across zero, one and several rows', () => {
    expect(selectFleetAccount([], null)).toBeUndefined()
    expect(selectFleetAccount([{ id: 'a' }], null)).toBe('a')
    expect(selectFleetAccount([{ id: 'a' }, { id: 'b' }], null)).toBe('a')
    expect(selectFleetAccount([{ id: 'a' }, { id: 'b' }], 'b')).toBe('b')
    expect(selectFleetAccount([{ id: 'a' }], 'gone')).toBe('a')
  })
  it('translates rate buckets and plan windows into the fleet row', () => {
    const row = fleetAccountFromLimits({
      providerId: 'meta',
      account: { id: 'work' },
      limits: {
        rateLimits: {
          requests: { limit: 120, remaining: 60, resetAt: '2026-10-06T13:00:00.000Z' },
          tokens: { limit: 600, remaining: 300, resetAt: '2026-10-06T13:00:00.000Z' },
        },
        planWindows: { daily: { usedPercent: 25, resetAt: '2026-10-07T00:00:00.000Z' } },
      },
      nowMs: NOW_MS,
    })
    expect(row).toMatchObject({ id: 'work', providerId: 'meta', requestsPerMinute: 2 })
    expect(row?.tokensPerMinute).toBe(10)
    expect(row?.usageLimits?.map((window) => window.id)).toEqual([
      'work-requests',
      'work-tokens',
      'work-daily',
    ])
    expect(row?.usageLimits?.find((window) => window.id === 'work-daily')).toMatchObject({
      unit: 'percent',
      remaining: 75,
      allowance: 100,
    })
  })
  it('drops expired buckets and keeps nothing when no limit is usable', () => {
    const row = fleetAccountFromLimits({
      providerId: 'meta',
      account: { id: 'work' },
      limits: {
        rateLimits: {
          requests: { limit: 120, remaining: 0, resetAt: '2026-10-06T11:00:00.000Z' },
        },
        planWindows: { daily: { usedPercent: 90, resetAt: null } },
      },
      nowMs: NOW_MS,
    })
    expect(row).toBeUndefined()
    expect(
      fleetAccountFromLimits({
        providerId: 'meta',
        account: { id: 'work' },
        limits: {},
        nowMs: NOW_MS,
      }),
    ).toBeUndefined()
  })
  it('pins a blocked account at zero and refuses a broken clock', () => {
    const row = fleetAccountFromLimits({
      providerId: 'meta',
      account: { id: 'work' },
      limits: { blocked: { reason: 'rateLimited', resetAt: '2026-10-06T13:00:00.000Z' } },
      nowMs: NOW_MS,
    })
    expect(row).toMatchObject({ requestsPerMinute: 0, tokensPerMinute: 0 })
    expect(() =>
      fleetAccountFromLimits({
        providerId: 'meta',
        account: { id: 'work' },
        limits: {},
        nowMs: NaN,
      }),
    ).toThrow(/fleet-account-invalid/)
  })
  it("reads the extension host's real settings keys and refuses corrupt ones", async () => {
    const seen: string[] = []
    const inspect: ResourceSettingsReader = (key) => {
      seen.push(key)
      return key === 'resourceCpuMaxPercent' || key === 'resourceMemoryMaxPercent'
        ? { globalValue: 50 }
        : {}
    }
    const sources = extensionFleetSources({ inspect })
    expect(await sources.settings()).toEqual({ cpuMaxPercent: 50, memoryMaxPercent: 50 })
    for (const key of [
      'resourceGovernor',
      'resourceCpuMaxPercent',
      'resourceMemoryMaxPercent',
      'resourceMemoryMinFreeGiB',
      'resourceGpuMaxPercent',
      'resourceDiskBusyMaxPercent',
      'resourceDiskMinFreeGiB',
      'resourceRelocate',
    ])
      expect(seen).toContain(key)
    expect(await sources.activeAccount()).toBeUndefined()
    expect(await sources.ci()).toEqual([])
    const bound = await applyFleetBinding(
      fleetFromHost({ ...HOST }, chainLanes(), AS_OF),
      fleetIoFromSources(sources),
    )
    expect(bound.machines[0]).toMatchObject({ caps: { cpuPercent: 50, memoryPercent: 50 } })
    expect(bound.machines[0]?.governorSlots).toBe(4)
    const corrupt = extensionFleetSources({
      inspect: (key) => (key === 'resourceCpuMaxPercent' ? { globalValue: 999 } : undefined),
    })
    await expect(
      applyFleetBinding(
        fleetFromHost({ ...HOST }, chainLanes(), AS_OF),
        fleetIoFromSources(corrupt),
      ),
    ).rejects.toThrow(/fleet-caps-invalid/)
  })
  it('reads the headless defaults through the same settings contract', async () => {
    const sources = headlessFleetSources()
    expect(await sources.settings()).toEqual({
      cpuMaxPercent: RESOURCE_CPU_DEFAULT_PERCENT,
      memoryMaxPercent: RESOURCE_MEMORY_DEFAULT_PERCENT,
    })
    const bound = await applyFleetBinding(
      fleetFromHost({ ...HOST }, chainLanes(), AS_OF),
      fleetIoFromSources(sources),
    )
    expect(bound.machines[0]).toMatchObject({
      caps: {
        cpuPercent: RESOURCE_CPU_DEFAULT_PERCENT,
        memoryPercent: RESOURCE_MEMORY_DEFAULT_PERCENT,
      },
    })
    expect(bound.machines[0]?.governorSlots).toBe(7)
  })
  it('drives all three sources through the real fleet port to one forecast', async () => {
    const calls = { settings: 0, activeAccount: 0, ci: 0 }
    const sources: FleetSources = {
      settings: () => {
        calls.settings += 1
        return { cpuMaxPercent: 100, memoryMaxPercent: 100 }
      },
      activeAccount: () => {
        calls.activeAccount += 1
        return fleetAccountFromLimits({
          providerId: 'meta',
          account: { id: 'work' },
          limits: {
            rateLimits: {
              requests: { limit: 60, remaining: 0, resetAt: '2026-10-07T00:00:00.000Z' },
            },
          },
          nowMs: NOW_MS,
        })
      },
      ci: () => {
        calls.ci += 1
        return [{ id: 'ci-1', concurrentJobs: 1, occupiedJobs: 0 }]
      },
    }
    const lanes = [scheduleLane('A'), scheduleLane('B')]
    const fleet = fleetSnapshotSchema.parse(
      await portsFor(fleetIoFromSources(sources)).fleet(lanes, AS_OF),
    )
    expect(calls).toEqual({ settings: 1, activeAccount: 1, ci: 1 })
    expect(fleet.machines[0]).toMatchObject({ caps: { cpuPercent: 100, memoryPercent: 100 } })
    expect(fleet.machines[0]?.governorSlots).toBe(fleet.slots.length)
    expect(fleet.ci).toHaveLength(1)
    expect(fleet.accounts[0]).toMatchObject({ id: 'work' })
    // The depleted window pins the forecast past the reset, not at the
    // two serial hours: the account source really shaped it.
    const trial = prepareEstimateSchedule(lanes, fleet).run(undefined)
    expect(trial.finishHours).toBeGreaterThan(2)
    expect(findEstimateBottleneck(lanes, fleet)).toMatchObject({ kind: 'accountRate' })
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
        accounts: () => ({ id: 'local', providerId: 'local', requestsPerMinute: 0.5 / 60 }),
      }).fleet(lanes, AS_OF),
    )
    expect(() => prepareEstimateSchedule(lanes, bound).run(undefined)).toThrow(/unschedulable:A/)
    const { fleet: budgeted } = await boundFleet()
    expect(prepareEstimateSchedule(lanes, budgeted).run(undefined).finishHours).toBe(1)
  })
  it('proves async readers run at fleet-call time, once per call', async () => {
    const seen: string[] = []
    const fleetIo: FleetBindingIo = {
      capacityCaps: () => {
        seen.push('caps')
        return { cpuMaxPercent: 100, memoryMaxPercent: 100 }
      },
      accounts: () => {
        seen.push('accounts')
        return undefined
      },
      ci: async () => {
        seen.push('ci')
        await Promise.resolve()
        return []
      },
    }
    const lanes = [scheduleLane('A')]
    const first = fleetSnapshotSchema.parse(await portsFor(fleetIo).fleet(lanes, AS_OF))
    expect(seen).toEqual(['caps', 'accounts', 'ci'])
    expect(first.machines[0]?.governorSlots).toBe(first.slots.length)
    seen.length = 0
    await portsFor(fleetIo).candidatePool(lanes, AS_OF)
    expect(seen).toEqual(['caps', 'accounts', 'ci'])
  })
})
