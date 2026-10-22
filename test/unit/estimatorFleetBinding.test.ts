// M117 C-M117-3R3: the fleet binding reads every fleet value from the
// component that owns it and never computes one. Machine parallelism stays
// the certified one serial slot; M107's settings ride the caps as threshold
// facts. M108's account row carries only read limits, stated when it cannot
// be converted, unknown with its source named when nothing was read. Each
// source refuses with its own detail on the production reader shape.
// Repository default timeout.
//
// Deleted round-3 pins of invented numbers (each failed while the governor
// contract was ignored): fleetSlotsForCaps unit pins (8/100/100 slots),
// caps-shaping-admission (governorSlots 6, six slots), the 1h-vs-2h slot
// finish split, the demand-budgeted row kept for an undefined reader, the
// rolling plan window over the time remaining, the zeroed blocked rates, and
// the fleet/candidatePool double read.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { findEstimateBottleneck } from '../../src/core/estimator/bottleneck'
import { canEstimateMachineRun, prepareEstimateSchedule } from '../../src/core/estimator/schedule'
import { estimatorSourcePorts, fleetFromHost } from '../../src/host/estimator/localFleet'
import {
  applyFleetBinding,
  extensionFleetSources,
  fleetAccountFromLimits,
  fleetIoFromSources,
  headlessFleetSources,
  selectFleetAccount,
  type FleetBindingIo,
  type FleetSources,
} from '../../src/host/estimator/fleetBinding'
import { resourceMachineStore } from '../../src/runtime/resources/settings'
import { fleetSnapshotSchema } from '../../src/shared/estimate'
import type { ResourceSettingsReader } from '../../src/shared/resources'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText, formatDateTime, fill, UI_TEXT } from '../../src/shared/l10n/text'
import { amount, scheduleLane } from './helpers/estimatorKindScheduleFixtures'

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

/** Workspace settings with the governor switched off and legal 50/50 ceilings. */
const offInspect: ResourceSettingsReader = (key) => {
  const values: Record<string, number | boolean> = {
    resourceGovernor: false,
    resourceCpuMaxPercent: 50,
    resourceMemoryMaxPercent: 50,
  }
  const globalValue = values[key]
  return globalValue === undefined ? {} : { globalValue }
}

const boundFleet = async () => {
  const lanes = [scheduleLane('A'), scheduleLane('B')]
  return {
    lanes,
    fleet: fleetSnapshotSchema.parse(await portsFor().fleet(lanes, AS_OF)),
  }
}

/** Every production assembly defines every reader: the error-blame tests use it. */
const productionIo = (sources: FleetSources): FleetBindingIo => fleetIoFromSources(sources)

describe('M117 fleet binding', () => {
  it('keeps the measured fleet byte-identical without readers', async () => {
    const base = fleetFromHost({ ...HOST }, [scheduleLane('A'), scheduleLane('B')], AS_OF)
    expect(await applyFleetBinding(base)).toEqual(base)
  })
  it('stamps the request asOf and reads the fleet once per estimate', async () => {
    const lanes = [scheduleLane('A'), scheduleLane('B')]
    const ports = portsFor().beginEstimate?.() ?? portsFor()
    const fleet = fleetSnapshotSchema.parse(await ports.fleet(lanes, AS_OF))
    const pool = fleetSnapshotSchema.parse(await ports.candidatePool(lanes, AS_OF))
    expect(fleet.asOf).toBe(AS_OF)
    expect(pool).toEqual(fleet)
    expect(fleet.machines).toHaveLength(1)
    expect(fleet.ci).toEqual([])
  })
  it('derives the current fleet and the candidate pool from one snapshot', async () => {
    const calls = { settings: 0, activeAccount: 0, ci: 0 }
    const sources: FleetSources = {
      settings: () => {
        calls.settings += 1
        return { cpuMaxPercent: 50, memoryMaxPercent: 60, enabled: true }
      },
      activeAccount: () => {
        calls.activeAccount += 1
        return { kind: 'no-reader', surface: 'runtime' }
      },
      ci: () => {
        calls.ci += 1
        return []
      },
    }
    const lanes = [scheduleLane('A')]
    const sourcePorts = portsFor(productionIo(sources))
    const ports = sourcePorts.beginEstimate?.() ?? sourcePorts
    const fleet = await ports.fleet(lanes, AS_OF)
    // A setting that changes between the two reads cannot describe two
    // different machines in one forecast: the pool reuses the fleet read.
    await ports.candidatePool(lanes, AS_OF)
    expect(calls).toEqual({ settings: 1, activeAccount: 1, ci: 1 })
    expect(fleetSnapshotSchema.parse(fleet).machines[0]?.caps).toMatchObject({
      cpuPercent: 50,
      memoryPercent: 60,
    })
    // A new estimate reads again: the memo never freezes the owners.
    await (sourcePorts.beginEstimate?.() ?? sourcePorts).fleet(lanes, '2026-10-06T13:00:00.000Z')
    expect(calls).toEqual({ settings: 2, activeAccount: 2, ci: 2 })
  })
  it('states the throttle thresholds as facts and never writes a slot count', async () => {
    const base = fleetFromHost({ ...HOST }, [scheduleLane('A'), scheduleLane('B')], AS_OF)
    const stated = await applyFleetBinding(base, {
      settings: () => ({ cpuMaxPercent: 50, memoryMaxPercent: 60, enabled: true }),
    })
    expect(stated.machines[0]).toMatchObject({
      governorSlots: 1,
      capacityByKind: expect.any(Array),
      caps: { slots: 1, cpuPercent: 50, memoryPercent: 60 },
    })
    expect(stated.machines[0]?.capacityByKind).toEqual(
      base.machines[0]?.capacityByKind.map((capacity) => ({ ...capacity })),
    )
    expect(stated.slots).toEqual(base.slots)
    // The schedule never reads those percents for admission: an 8-core
    // machine at 50/60 still runs its one certified serial slot.
    const lanes = [scheduleLane('A'), scheduleLane('B')]
    const serial = await applyFleetBinding(fleetFromHost({ ...HOST }, lanes, AS_OF), {
      settings: () => ({ cpuMaxPercent: 50, memoryMaxPercent: 60, enabled: true }),
    })
    expect(prepareEstimateSchedule(lanes, serial).run(undefined).finishHours).toBe(2)
  })
  it('keeps the certified row with the governor off or no reading', async () => {
    const base = fleetFromHost({ ...HOST }, [scheduleLane('A'), scheduleLane('B')], AS_OF)
    // Switched off: no throttle scenario and no threshold row.
    expect(
      await applyFleetBinding(base, {
        settings: () => ({ cpuMaxPercent: 50, memoryMaxPercent: 60, enabled: false }),
      }),
    ).toEqual({ ...base, ci: base.ci })
    expect(await applyFleetBinding(base, { settings: () => undefined })).toEqual({
      ...base,
      ci: base.ci,
    })
  })
  it('refuses a corrupt machine reading with fleet-caps-invalid', async () => {
    const base = fleetFromHost({ ...HOST }, [scheduleLane('A'), scheduleLane('B')], AS_OF)
    const cpu = (cpuMaxPercent: number) =>
      applyFleetBinding(base, {
        settings: () => ({ cpuMaxPercent, memoryMaxPercent: 70, enabled: true }),
        activeAccount: () => ({ kind: 'no-reader', surface: 'runtime' }),
        ci: () => [],
      })
    await expect(cpu(50)).resolves.toBeDefined()
    for (const cpuMaxPercent of [-1, 101, NaN])
      await expect(cpu(cpuMaxPercent)).rejects.toThrow(/Estimate failed: fleet-caps-invalid/)
  })
  it('refuses a broken fleet structure with fleet-binding-invalid', async () => {
    const base = fleetFromHost({ ...HOST }, [scheduleLane('A'), scheduleLane('B')], AS_OF)
    // Two slots on a one-slot machine break the slot invariant (type-valid,
    // schema-invalid: no cast needed for the schema-level refusal).
    const broken = {
      ...base,
      slots: [...base.slots, { ...base.slots[0]!, id: 'local-1' }],
    }
    await expect(
      applyFleetBinding(broken, {
        settings: () => ({ cpuMaxPercent: 50, memoryMaxPercent: 60, enabled: true }),
        activeAccount: () => ({ kind: 'no-reader', surface: 'runtime' }),
        ci: () => [],
      }),
    ).rejects.toThrow(/Estimate failed: fleet-binding-invalid/)
  })
  it('names the account source on the production reader shape, never the CI row', async () => {
    const base = fleetFromHost({ ...HOST }, [scheduleLane('A'), scheduleLane('B')], AS_OF)
    // A corrupt account id is the account's detail even with CI defined.
    await expect(
      applyFleetBinding(
        base,
        productionIo({
          settings: () => ({ cpuMaxPercent: 50, memoryMaxPercent: 60, enabled: true }),
          activeAccount: () => ({
            kind: 'limits',
            providerId: 'meta',
            accountId: '!!!',
            snapshot: {},
            nowMs: NOW_MS,
          }),
          ci: () => [],
        }),
      ),
    ).rejects.toThrow(/Estimate failed: fleet-account-invalid/)
    // A corrupt CI row is the CI detail with the account reader defined.
    await expect(
      applyFleetBinding(
        base,
        productionIo({
          settings: () => ({ cpuMaxPercent: 50, memoryMaxPercent: 60, enabled: true }),
          activeAccount: () => ({ kind: 'no-reader', surface: 'runtime' }),
          ci: () => [{ id: 'ci-1', concurrentJobs: 1, occupiedJobs: 2 }],
        }),
      ),
    ).rejects.toThrow(/Estimate failed: fleet-ci-invalid/)
  })
  it('carries CI concurrency rows but never invents one', async () => {
    const base = fleetFromHost({ ...HOST }, [scheduleLane('A'), scheduleLane('B')], AS_OF)
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
    // No reader, no row: the schedule records it as not read.
    const lanes = [scheduleLane('A')]
    const trial = prepareEstimateSchedule(
      lanes,
      await applyFleetBinding(fleetFromHost({ ...HOST }, lanes, AS_OF), {
        activeAccount: () => ({ kind: 'no-reader', surface: 'runtime' }),
        ci: () => [],
      }),
    ).run(undefined)
    expect(trial.unknownLimits).not.toContain('CI capacity unknown: no reader.')
  })
  it('reads unknown limits with the no-reader seam, never a demand rate', async () => {
    for (const surface of ['editor', 'runtime'] as const) {
      const lanes = [scheduleLane('A')]
      const fleet = await applyFleetBinding(fleetFromHost({ ...HOST }, lanes, AS_OF), {
        activeAccount: () => ({ kind: 'no-reader', surface }),
      })
      expect(fleet.accounts).toEqual([
        {
          id: 'local',
          providerId: 'local',
          statedLimits: [`Unknown account limits on ${surface}.`],
        },
      ])
      expect(fleet.slots.map((slot) => slot.accountId)).toEqual(['local'])
      const trial = prepareEstimateSchedule(lanes, fleet).run(undefined)
      expect(trial.unknownLimits).toContain(`Unknown account limits on ${surface}.`)
      expect(trial.unknownLimits).toContain('local:requestsPerMinute')
      expect(trial.unknownLimits).toContain('local:tokensPerMinute')
      expect(trial.unknownLimits).toContain('local:usageLimits')
      expect(trial.finishHours).toBe(1)
    }
  })
  it('reads the active account limits through the panel reader', async () => {
    const sources = extensionFleetSources({
      inspect: () => undefined,
      readUsage: () =>
        Promise.resolve({
          observedAtMs: NOW_MS,
          tier: 'captured',
          window: { usedPercent: 100, resetsAtMs: NOW_MS + 3_600_000, windowDurationMins: 300 },
          weekly: { usedPercent: 25, resetsAtMs: NOW_MS + 86_400_000 },
        }),
    })
    const lane = scheduleLane('A')
    const fleet = await applyFleetBinding(
      fleetFromHost({ ...HOST }, [lane], AS_OF),
      productionIo(sources),
    )
    expect(prepareEstimateSchedule([lane], fleet).run().schedule[0]?.start).toBe(
      '2026-10-06T13:00:00.000Z',
    )
  })
  it('names a registry account with unknown limits', async () => {
    const lanes = [scheduleLane('A')]
    const fleet = await applyFleetBinding(fleetFromHost({ ...HOST }, lanes, AS_OF), {
      activeAccount: () => ({ kind: 'registry', providerId: 'meta', accountId: 'shop' }),
    })
    expect(fleet.accounts).toEqual([
      {
        id: 'shop',
        providerId: 'meta',
        statedLimits: ['Unknown: limits unread for meta/shop.'],
      },
    ])
    expect(fleet.slots.map((slot) => slot.accountId)).toEqual(['shop'])
    const trial = prepareEstimateSchedule(lanes, fleet).run(undefined)
    expect(trial.unknownLimits).toContain('Unknown: limits unread for meta/shop.')
    expect(trial.unknownLimits).toContain('shop:requestsPerMinute')
  })
  it('selects the active account across zero, one and several rows', () => {
    expect(selectFleetAccount([], null)).toBeUndefined()
    expect(selectFleetAccount([{ id: 'a' }], null)).toBe('a')
    expect(selectFleetAccount([{ id: 'a' }, { id: 'b' }], null)).toBe('a')
    expect(selectFleetAccount([{ id: 'a' }, { id: 'b' }], 'b')).toBe('b')
    expect(selectFleetAccount([{ id: 'a' }], 'gone')).toBe('a')
  })
  it('preserves current buckets without inventing a sustainable rate', () => {
    const row = fleetAccountFromLimits({
      providerId: 'meta',
      account: { id: 'work' },
      limits: {
        rateLimits: {
          requests: { limit: 120, remaining: 60, resetAt: '2026-10-06T13:00:00.000Z' },
          tokens: { limit: 600, remaining: 300, resetAt: '2026-10-06T13:00:00.000Z' },
        },
      },
      nowMs: NOW_MS,
    })
    expect(row?.requestsPerMinute).toBeUndefined()
    expect(row?.tokensPerMinute).toBeUndefined()
    expect(row?.usageLimits?.map((window) => window.id)).toEqual(['work-requests', 'work-tokens'])
    expect(row?.usageLimits?.[0]).toMatchObject({
      kind: 'current',
      unit: 'requests',
      remaining: 60,
      allowance: 120,
    })
    expect(row?.statedLimits).toHaveLength(2)
  })
  it('shapes a plan window only from its captured duration and states the rest', () => {
    const row = fleetAccountFromLimits({
      providerId: 'meta',
      account: { id: 'work' },
      limits: {
        planWindows: {
          window: {
            usedPercent: 60,
            resetAt: '2026-10-06T13:00:00.000Z',
            windowDurationMins: 300,
          },
          weekly: { usedPercent: 25, resetAt: '2026-10-13T00:00:00.000Z' },
        },
      },
      nowMs: NOW_MS,
    })
    // The short window is fixed over the provider's own five hours, never
    // over the one hour remaining until this reset.
    expect(row?.usageLimits).toEqual([
      {
        id: 'work-window',
        kind: 'rolling',
        periodSeconds: 18_000,
        unit: 'percent',
        remaining: 40,
        allowance: 100,
        resetsAt: '2026-10-06T13:00:00.000Z',
        timeZone: 'UTC',
      },
    ])
    // The weekly window reports no period, so it is stated, never shaped.
    expect(row?.statedLimits).toEqual([
      fill(UI_TEXT.estimatePlanWindowUnknown, {
        source: 'meta/work/weekly',
        percent: '25%',
        reset: formatDateTime(Date.parse('2026-10-13T00:00:00.000Z')),
      }),
    ])
  })
  it('states an unconvertible percent window instead of throwing unknown-demand', async () => {
    const lanes = [scheduleLane('A')]
    const fleet = await applyFleetBinding(fleetFromHost({ ...HOST }, lanes, AS_OF), {
      activeAccount: () => ({
        kind: 'limits',
        providerId: 'meta',
        accountId: 'work',
        snapshot: {
          planWindows: {
            window: {
              usedPercent: 60,
              resetAt: '2026-10-06T13:00:00.000Z',
              windowDurationMins: 300,
            },
            weekly: { usedPercent: 25, resetAt: '2026-10-13T00:00:00.000Z' },
          },
        },
        nowMs: NOW_MS,
      }),
    })
    // Plan-snapshot lanes leave percent demand unknown: both windows are
    // stated and the forecast continues with what it knows.
    const trial = prepareEstimateSchedule(lanes, fleet).run(undefined)
    expect(trial.finishHours).toBe(1)
    expect(trial.unknownLimits).toContain(
      fill(UI_TEXT.estimatePercentDemandUnknown, {
        source: 'work/work-window',
        reset: formatDateTime(Date.parse('2026-10-06T13:00:00.000Z')),
      }),
    )
    expect(trial.unknownLimits).toContain(
      fill(UI_TEXT.estimatePlanWindowUnknown, {
        source: 'meta/work/weekly',
        percent: '25%',
        reset: formatDateTime(Date.parse('2026-10-13T00:00:00.000Z')),
      }),
    )
  })
  it('enforces a read percent window once the lanes price percent demand', async () => {
    const lane = scheduleLane('A')
    lane.resources.accountPercentPerHour = amount(60)
    const fleet = await applyFleetBinding(fleetFromHost({ ...HOST }, [lane], AS_OF), {
      activeAccount: () => ({
        kind: 'limits',
        providerId: 'meta',
        accountId: 'work',
        snapshot: {
          planWindows: {
            window: {
              usedPercent: 90,
              resetAt: '2026-10-06T13:00:00.000Z',
              windowDurationMins: 300,
            },
          },
        },
        nowMs: NOW_MS,
      }),
    })
    // Ten percent of the window is left and the lane burns sixty per hour:
    // the lane starts ten minutes before the fixed reset, spends the
    // remainder, and renews across it instead of an invented cadence.
    const trial = prepareEstimateSchedule([lane], fleet).run(undefined)
    expect(trial.schedule[0]?.start).toBe('2026-10-06T12:50:00.000Z')
    expect(trial.schedule[0]?.end).toBe('2026-10-06T13:50:00.000Z')
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
    expect(row?.statedLimits).toHaveLength(1)
    expect(
      fleetAccountFromLimits({
        providerId: 'meta',
        account: { id: 'work' },
        limits: {},
        nowMs: NOW_MS,
      }),
    ).toBeUndefined()
  })
  it('waits for the reset behind a full window with a read rate', async () => {
    const lanes = [scheduleLane('A'), scheduleLane('B')]
    const fleet = await applyFleetBinding(fleetFromHost({ ...HOST }, lanes, AS_OF), {
      activeAccount: () => ({
        kind: 'limits',
        providerId: 'meta',
        accountId: 'work',
        snapshot: {
          rateLimits: {
            requests: { limit: 120, remaining: 0, resetAt: '2026-10-07T00:00:00.000Z' },
          },
          planWindows: {
            weekly: { usedPercent: 100, resetAt: '2026-10-07T00:00:00.000Z' },
          },
        },
        nowMs: NOW_MS,
      }),
    })
    // Paid work cannot start before the reset: the forecast waits for it and
    // names the account rate as its bottleneck.
    const trial = prepareEstimateSchedule(lanes, fleet).run(undefined)
    expect(trial.finishHours).toBeGreaterThan(2)
    expect(findEstimateBottleneck(lanes, fleet)).toMatchObject({ kind: 'accountRate' })
  })
  it('preserves a full window reset without inventing a read rate', async () => {
    const base = fleetFromHost({ ...HOST }, [scheduleLane('A'), scheduleLane('B')], AS_OF)
    const blocked = (snapshot: {
      planWindows?: Record<string, { usedPercent: number; resetAt: string | null }>
    }) =>
      applyFleetBinding(
        base,
        productionIo({
          settings: () => ({ cpuMaxPercent: 50, memoryMaxPercent: 60, enabled: true }),
          activeAccount: () => ({
            kind: 'limits',
            providerId: 'meta',
            accountId: 'work',
            snapshot,
            nowMs: NOW_MS,
          }),
          ci: () => [],
        }),
      )
    // A weekly window at 100 percent used cannot start paid work before its
    // reset, and no read rate bounds what follows: the forecast refuses
    // instead of finishing on slot math alone.
    await expect(
      blocked({
        planWindows: { weekly: { usedPercent: 100, resetAt: '2026-10-07T00:00:00.000Z' } },
      }),
    ).resolves.toMatchObject({ accounts: [{ availableAt: '2026-10-07T00:00:00.000Z' }] })
    // A vendor block with no reset refuses without a date to wait for.
    expect(() =>
      fleetAccountFromLimits({
        providerId: 'meta',
        account: { id: 'work' },
        limits: { blocked: { reason: 'rateLimited', resetAt: null } },
        nowMs: NOW_MS,
      }),
    ).toThrow(/fleet-account-blocked: meta work reset unknown/)
    await expect(blocked({ planWindows: {} })).resolves.toBeDefined()
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
    expect(await sources.settings()).toMatchObject({
      cpuMaxPercent: 50,
      memoryMaxPercent: 50,
      enabled: true,
    })
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
    // The editor holds no account-limits reader: the seam, never a stub.
    expect(await sources.activeAccount()).toEqual({ kind: 'no-reader', surface: 'editor' })
    expect(await sources.ci()).toEqual([])
    // The production assembly states the thresholds as facts on the
    // certified one serial slot, through the real fleet port.
    const bound = await applyFleetBinding(
      fleetFromHost({ ...HOST }, [scheduleLane('A'), scheduleLane('B')], AS_OF),
      productionIo(sources),
    )
    expect(bound.machines[0]).toMatchObject({
      caps: { slots: 1, cpuPercent: 50, memoryPercent: 50 },
    })
    expect(bound.machines[0]?.governorSlots).toBe(1)
    expect(bound.slots).toHaveLength(1)
    expect(bound.accounts).toEqual([
      {
        id: 'local',
        providerId: 'local',
        statedLimits: ['Unknown account limits on editor.'],
      },
    ])
    // A governor that is off states no threshold row.
    const off = extensionFleetSources({ inspect: offInspect })
    const offFleet = await applyFleetBinding(
      fleetFromHost({ ...HOST }, [scheduleLane('A'), scheduleLane('B')], AS_OF),
      productionIo(off),
    )
    expect(offFleet.machines[0]?.caps).toMatchObject({ cpuPercent: 100, memoryPercent: 100 })
    const corrupt = extensionFleetSources({
      inspect: (key) => (key === 'resourceCpuMaxPercent' ? { globalValue: 999 } : undefined),
    })
    await expect(
      applyFleetBinding(
        fleetFromHost({ ...HOST }, [scheduleLane('A'), scheduleLane('B')], AS_OF),
        productionIo(corrupt),
      ),
    ).rejects.toThrow(/fleet-caps-invalid/)
  })
  it('reads headless settings through the governor resources.json reader', async () => {
    // Lane scratch lives under TMPDIR (a /tmp tmpfs quota is shared); the
    // fallback keeps Windows CI green where TMPDIR is unset.
    const folder = mkdtempSync(path.join(process.env['TMPDIR'] ?? tmpdir(), 'cm1173-fleet-'))
    try {
      const settingsFile = path.join(folder, 'resources.json')
      const owners = (accounts: { list(): { id: string }[] }) => {
        // One store behind both readers, like the production assembly.
        const store = resourceMachineStore({
          settingsFile,
          resumeFile: path.join(folder, 'resource-resume.json'),
          sleep: () => Promise.resolve(),
        })
        return headlessFleetSources({
          readSettings: () => store.readSettings(),
          readSettingsWithOrigin: () => store.readSettingsWithOrigin(),
          listAccounts: () => Promise.resolve(accounts.list()),
        })
      }
      // A missing file carries the schema defaults the governor itself runs:
      // no ceilings, so the certified row stands with default provenance.
      expect(await owners({ list: () => [] }).settings()).toMatchObject({
        cpuMaxPercent: 100,
        memoryMaxPercent: 100,
        enabled: true,
        origin: { source: 'resources.json', cpuPercent: 'default', memoryPercent: 'default' },
      })
      const missing = await applyFleetBinding(
        fleetFromHost({ ...HOST }, [scheduleLane('A'), scheduleLane('B')], AS_OF),
        productionIo(owners({ list: () => [] })),
      )
      expect(missing.machines[0]?.caps).toMatchObject({
        cpuPercent: 100,
        memoryPercent: 100,
        origin: { source: 'resources.json', cpuPercent: 'default', memoryPercent: 'default' },
      })
      expect(missing.machines[0]?.governorSlots).toBe(1)
      // A present file is the configured value: CPU 40 (a legal setting)
      // reaches the forecast, and the registry names the account read.
      writeFileSync(settingsFile, JSON.stringify({ 'museSpark.resourceCpuMaxPercent': 40 }))
      const configured = await applyFleetBinding(
        fleetFromHost({ ...HOST }, [scheduleLane('A'), scheduleLane('B')], AS_OF),
        productionIo(owners({ list: () => [{ id: 'shop' }] })),
      )
      expect(configured.machines[0]?.caps).toMatchObject({ cpuPercent: 40 })
      expect(configured.accounts).toEqual([
        {
          id: 'shop',
          providerId: 'meta',
          statedLimits: ['Unknown: limits unread for meta/shop.'],
        },
      ])
      // A governor that is off states no threshold row.
      writeFileSync(settingsFile, JSON.stringify({ 'museSpark.resourceGovernor': false }))
      const off = await applyFleetBinding(
        fleetFromHost({ ...HOST }, [scheduleLane('A'), scheduleLane('B')], AS_OF),
        productionIo(owners({ list: () => [] })),
      )
      expect(off.machines[0]?.caps).toMatchObject({ cpuPercent: 100, memoryPercent: 100 })
      // A malformed file refuses: the governor cannot run on it either.
      writeFileSync(settingsFile, '{"museSpark.resourceCpuMaxPercent":')
      await expect(
        applyFleetBinding(
          fleetFromHost({ ...HOST }, [scheduleLane('A'), scheduleLane('B')], AS_OF),
          productionIo(owners({ list: () => [] })),
        ),
      ).rejects.toThrow(/fleet-caps-invalid/)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
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
})
