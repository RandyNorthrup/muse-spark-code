// RVCM1173C: production owner contracts, repository timeouts, no live calls.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyFleetBinding,
  extensionFleetSources,
  fleetAccountFromLimits,
  fleetIoFromSources,
  headlessFleetSources,
} from '../../src/host/estimator/fleetBinding'
import { estimatorSourcePorts, fleetFromHost } from '../../src/host/estimator/localFleet'
import { createEstimatorRun } from '../../src/host/estimator/estimatorEntry'
import { findEstimateBottleneck } from '../../src/core/estimator/bottleneck'
import { prepareEstimateSchedule } from '../../src/core/estimator/schedule'
import { EstimateWaveStarter } from '../../src/core/estimator/provision/start'
import { createUsageRecording } from '../../src/core/usage/recording'
import { estimateFailureText, runEstimateCommand } from '../../src/runtime/estimator/command'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { resourceSettingsSchema } from '../../src/shared/resources'
import { type AccountLimitsSnapshot } from '../../src/core/accounts/thresholds'
import { amount, scheduleLane, simulationInputs } from './helpers/estimatorScheduleFixtures'
import { FakeEstimateStart } from './helpers/estimator/fakes'
import { chainSnapshot } from './helpers/estimator/fixtures'

const AS_OF = '2026-10-06T12:00:00.000Z'
const NOW = Date.parse(AS_OF)
const HOST = { platform: 'linux', arch: 'x64', cores: 8, ramGiB: 16 }
const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
beforeEach(() => {
  setUiText(EN, BASE_LOCALE)
})
const bind = (snapshot: AccountLimitsSnapshot, lane = scheduleLane('A')) =>
  applyFleetBinding(fleetFromHost(HOST, [lane], AS_OF), {
    activeAccount: () => ({
      kind: 'limits',
      providerId: 'meta',
      accountId: 'work',
      snapshot,
      nowMs: NOW,
    }),
  })

describe('RVCM1173C owner constraints', () => {
  it('binds the real usage changed recording on the panel and ACP sources', async () => {
    const recording = createUsageRecording({
      client: 'test',
      now: () => NOW,
      newId: () => 'test-limit',
      isEnabled: () => false,
      log,
      writer: () => {
        throw new Error('history disabled')
      },
    })
    recording.limit({
      backend: 'museCode',
      provider: 'museCode',
      source: 'museCode',
      observedAt: NOW,
      windows: [{ id: 'window', usedPercent: 100, resetsAt: NOW + 3_600_000, windowMins: 300 }],
    })
    for (const sources of [
      extensionFleetSources({
        inspect: () => undefined,
        readLiveLimits: () => recording.limits?.() ?? [],
      }),
      headlessFleetSources({
        readSettings: () => Promise.resolve(resourceSettingsSchema.parse({})),
        listAccounts: () => Promise.resolve([]),
        readLiveLimits: () => recording.limits?.() ?? [],
      }),
    ]) {
      const fleet = await applyFleetBinding(
        fleetFromHost(HOST, [scheduleLane('A')], AS_OF),
        fleetIoFromSources(sources),
      )
      const trial = prepareEstimateSchedule([scheduleLane('A')], fleet).run()
      expect(trial.schedule[0]?.start).toBe('2026-10-06T13:00:00.000Z')
      expect(findEstimateBottleneck([scheduleLane('A')], fleet).kind).toBe('accountRate')
    }
  })
  it.each([0, 50])('never invents a bucket period or rate at minute %s', async (minute) => {
    const snapshot = {
      rateLimits: { requests: { limit: 120, remaining: 120, resetAt: '2026-10-06T13:00:00.000Z' } },
    }
    const row = fleetAccountFromLimits({
      providerId: 'meta',
      account: { id: 'work' },
      limits: snapshot,
      nowMs: NOW + minute * 60_000,
    })
    expect(row?.requestsPerMinute).toBeUndefined()
    expect(row?.usageLimits?.[0]).toMatchObject({
      kind: 'current',
      remaining: 120,
      allowance: 120,
      resetsAt: '2026-10-06T13:00:00.000Z',
    })
    expect(row?.usageLimits?.[0]).not.toHaveProperty('periodSeconds')
    const lane = scheduleLane('A')
    lane.resources.accountRequestsPerHour = amount(600)
    const trial = prepareEstimateSchedule([lane], await bind(snapshot, lane)).run()
    expect(trial.unknownLimits).toContain('work:requestsPerMinute')
    expect(trial.schedule[0]?.start).toBe('2026-10-06T12:48:00.000Z')
  })
  const cases = [40, 100].flatMap((usedPercent) =>
    [null, '2026-10-06T13:00:00.000Z'].flatMap((resetAt) =>
      [undefined, '2026-10-06T12:30:00.000Z', '2026-10-06T14:00:00.000Z', null].map((vendor) => ({
        usedPercent,
        resetAt,
        vendor,
      })),
    ),
  )
  it.each(cases)(
    'window $usedPercent reset $resetAt vendor $vendor',
    async ({ usedPercent, resetAt, vendor }) => {
      const snapshot: AccountLimitsSnapshot = {
        planWindows: { window: { usedPercent, resetAt, windowDurationMins: 300 } },
        ...(vendor !== undefined && { blocked: { reason: 'rateLimited', resetAt: vendor } }),
      }
      const lane = scheduleLane('A')
      lane.resources.accountPercentPerHour = amount(60)
      if (vendor === null || (usedPercent === 100 && resetAt === null)) {
        await expect(bind(snapshot, lane)).rejects.toThrow(
          /fleet-account-blocked meta\/work reset unknown/,
        )
        return
      }
      const fleet = await bind(snapshot, lane)
      const trial = prepareEstimateSchedule([lane], fleet).run()
      let start = usedPercent === 100 ? '2026-10-06T13:00:00.000Z' : (vendor ?? AS_OF)
      if (vendor === '2026-10-06T14:00:00.000Z') start = vendor
      expect(trial.schedule[0]?.start).toBe(start)
      expect(trial.schedule[0]?.end).toBe(new Date(Date.parse(start) + 3_600_000).toISOString())
      expect(findEstimateBottleneck([lane], fleet).kind).toBe(
        start === AS_OF ? 'criticalPath' : 'accountRate',
      )
    },
  )
  it('retains the captured full percent allowance after its first reset', async () => {
    const lane = scheduleLane('A', { estimatedHours: 3 })
    lane.resources.accountPercentPerHour = amount(60)
    const fleet = await bind(
      {
        planWindows: {
          window: {
            usedPercent: 100,
            resetAt: '2026-10-06T13:00:00.000Z',
            windowDurationMins: 300,
          },
        },
      },
      lane,
    )
    expect(fleet.accounts[0]?.usageLimits?.[0]).toMatchObject({
      unit: 'percent',
      remaining: 0,
      allowance: 100,
      periodSeconds: 18_000,
    })
    expect(prepareEstimateSchedule([lane], fleet).run().schedule[0]?.end).toBe(
      '2026-10-06T19:20:00.000Z',
    )
  })
  it('refuses malformed limits before translation can discard them', async () => {
    await expect(
      bind({ planWindows: { weekly: { usedPercent: 101, resetAt: 'bad-date' } } }),
    ).rejects.toThrow(/fleet-account-invalid/)
  })
  it('preserves the account metadata owner refusal', async () => {
    const sources = headlessFleetSources({
      readSettings: () => Promise.resolve(resourceSettingsSchema.parse({})),
      listAccounts: () =>
        Promise.reject(Object.assign(new Error('private path'), { code: 'unavailable' })),
    })
    await expect(sources.activeAccount()).rejects.toThrow(/fleet-account-invalid.*unavailable/)
  })
  it.each([AS_OF, '2026-10-06T12:01:00.000Z'])(
    'isolates overlapping estimates and shares each fleet with its own pool at %s',
    async (secondAsOf) => {
      let reads = 0
      const held = Promise.withResolvers<undefined>()
      const started = Promise.withResolvers<undefined>()
      const ports = estimatorSourcePorts(
        () => ({ enabled: false, networkAllowed: false, maxAgeMs: 0, catalogUrls: [] }),
        (_goal, asOf) => Promise.resolve({ ...chainSnapshot(), asOf }),
        {
          settings: () => ({
            cpuMaxPercent: 50 + 10 * reads++,
            memoryMaxPercent: 90,
            enabled: true,
          }),
        },
      )
      let histories = 0
      ports.history = async () => {
        if (histories++ === 0) {
          started.resolve(undefined)
          await held.promise
        }
        return []
      }
      const run = createEstimatorRun(ports, EN, BASE_LOCALE)
      const request = simulationInputs().request
      const first = run.estimate({ ...request, asOf: AS_OF }, new AbortController().signal)
      await started.promise
      const second = await run.estimate(
        { ...request, asOf: secondAsOf },
        new AbortController().signal,
      )
      held.resolve(undefined)
      const a = await first
      expect(reads).toBe(2)
      expect(a.inputs.fleet.machines[0]?.caps.cpuPercent).toBe(50)
      expect(second.inputs.fleet.machines[0]?.caps.cpuPercent).toBe(60)
    },
  )
  it.each([{ ci: [] }, { ci: [{ id: 'unused-ci', concurrentJobs: 1, occupiedJobs: 0 }] }])(
    'starts a first wave without CI when no lane demands it: %j',
    async ({ ci }) => {
      const inputs = simulationInputs()
      inputs.fleet.ci = ci
      const board = new FakeEstimateStart()
      expect(prepareEstimateSchedule(inputs.lanes, inputs.fleet).run().unknownLimits).not.toContain(
        'ci unknown: not read',
      )
      await expect(new EstimateWaveStarter(board).start(inputs)).resolves.toEqual(['A'])
    },
  )
  it('keeps fleet refusal source and reset through safe host formatting and CLI', async () => {
    let error: Error = new Error('missing refusal')
    try {
      await bind({ planWindows: { weekly: { usedPercent: 100, resetAt: null } } })
    } catch (error_) {
      if (!(error_ instanceof Error)) throw error_
      error = error_
    }
    expect(estimateFailureText(error)).toContain('meta/work')
    expect(estimateFailureText(error)).toContain('reset unknown')
    const output: string[] = []
    expect(
      await runEstimateCommand(['M117'], {
        context: () => ({ asOf: AS_OF, optimize: 'cost' }),
        runner: { estimate: () => Promise.reject(error) },
        money: { price: () => '' },
        write: () => undefined,
        error: (text) => {
          output.push(text)
        },
        signal: new AbortController().signal,
      }),
    ).toBe(1)
    expect(output[0]).toContain('reset unknown')
    expect(estimateFailureText(new Error('/private/path'))).not.toContain('/private')
  })
  it('distinguishes defaults from equal explicitly configured thresholds', async () => {
    const lane = scheduleLane('A')
    const defaults = await applyFleetBinding(
      fleetFromHost(HOST, [lane], AS_OF),
      fleetIoFromSources(extensionFleetSources({ inspect: () => undefined })),
    )
    const configured = await applyFleetBinding(
      fleetFromHost(HOST, [lane], AS_OF),
      fleetIoFromSources(
        extensionFleetSources({
          inspect: (key) => {
            if (key === 'resourceMemoryMaxPercent') return { globalValue: 90 }
            return key === 'resourceCpuMaxPercent' ? { globalValue: 85 } : undefined
          },
        }),
      ),
    )
    expect(defaults.machines[0]?.caps).toMatchObject({
      origin: { cpuPercent: 'default', memoryPercent: 'default', source: 'configuration' },
    })
    expect(configured.machines[0]?.caps).toMatchObject({
      origin: { cpuPercent: 'configured', memoryPercent: 'configured', source: 'configuration' },
    })
  })
  it('says default in the forecast while retaining its per-value source', async () => {
    const ports = estimatorSourcePorts(
      () => ({ enabled: false, networkAllowed: false, maxAgeMs: 0, catalogUrls: [] }),
      (_goal, asOf) => Promise.resolve({ ...chainSnapshot(), asOf }),
      fleetIoFromSources(extensionFleetSources({ inspect: () => undefined })),
    )
    const section = await createEstimatorRun(ports, EN, BASE_LOCALE).estimate(
      { ...simulationInputs().request, asOf: AS_OF },
      new AbortController().signal,
    )
    expect(
      section.qualifications?.some((row) =>
        row.unknownLimits.some((note) =>
          note.startsWith('Default settings: configuration/cpuPercent'),
        ),
      ),
    ).toBe(true)
  })
  it('reads explanation templates in the installed language at estimate time', async () => {
    setUiText(
      {
        ...EN,
        estimateNoAccountReader: 'LECTEUR ABSENT {source}',
        estimatePercentDemandUnknown: 'DEMANDE INCONNUE {source} {reset}',
      },
      'fr',
    )
    const lane = scheduleLane('A')
    const fleet = await applyFleetBinding(fleetFromHost(HOST, [lane], AS_OF), {
      activeAccount: () => ({ kind: 'no-reader', surface: 'editor' }),
    })
    expect(fleet.accounts[0]?.statedLimits).toEqual(['LECTEUR ABSENT editor'])
    const percentFleet = await bind({
      planWindows: {
        window: { usedPercent: 40, resetAt: '2026-10-06T13:00:00.000Z', windowDurationMins: 300 },
      },
    })
    expect(
      prepareEstimateSchedule([lane], percentFleet)
        .run()
        .unknownLimits.some((note) => note.startsWith('DEMANDE INCONNUE')),
    ).toBe(true)
  })
})
