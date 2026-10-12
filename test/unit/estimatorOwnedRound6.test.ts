// RVCM1173E round-6 regressions: owned observations cannot be skipped.
import { describe, expect, it, vi } from 'vitest'
import { currentOwnedLimitSnapshots, type OwnedLimitInput } from '../../src/core/usage/recording'
import { ownedRecording } from './helpers/ownedRecording'
import { estimateAccountOwnerSchema, estimateLimitFactSchema } from '../../src/shared/estimateFacts'
import { ESTIMATE_FACT_TRANSLATORS } from '../../src/core/estimator/limitFacts'
import { prepareEstimateSchedule } from '../../src/core/estimator/schedule'
import {
  bindEstimatorFleet,
  extensionFleetSources,
  fleetIoFromSources,
  headlessFleetSources,
} from '../../src/host/estimator/fleetBinding'
import { fleetFromHost } from '../../src/host/estimator/localFleet'
import { reportFactsFromContext } from '../../src/core/estimator/reportFacts'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import { resourceSettingsSchema } from '../../src/shared/resources'
import { amount, scheduleLane } from './helpers/estimatorScheduleFixtures'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeMspHost, fakeInitializeResult, settle } from './helpers/fakeMsp'
import { legacyUsdSchema, type UsdAmount } from '../../src/shared/usdSchema'
const usd = (value: number): UsdAmount => legacyUsdSchema.parse(value)

const AS_OF = '2026-10-06T12:00:00.000Z'
const NOW = Date.parse(AS_OF)
const HOST = { platform: 'linux', arch: 'x64', cores: 4, ramGiB: 8 }
function silentRecording(at: number = NOW, warn?: () => void) {
  return ownedRecording(at, warn).port
}
function changedUsage(observedAtMs: number) {
  return {
    observedAtMs,
    tier: 'opaque',
    window: { usedPercent: 62, resetsAtMs: observedAtMs + 100_000, windowDurationMins: 300 },
    weekly: { usedPercent: 80, resetsAtMs: observedAtMs + 200_000 },
  }
}
function input(observedAt: number, usedPercent: number): OwnedLimitInput {
  return {
    backend: 'museCode',
    provider: 'museCode',
    source: 'museCode',
    observedAt,
    windows: [{ id: 'window', usedPercent, resetsAt: NOW + 3_600_000, windowMins: 60 }],
  }
}

// 0.1 * 3 is 0.30000000000000004 as doubles: the three-hour lane at USD
// 0.1/hour with USD 0.3 remaining must still be admitted.
async function admitBoundary(ratePerHour: number, hours: number, remainingUsd: number) {
  const journal = silentRecording()
  journal.scopeLimits?.({ accountId: 'work', generation: '1', backend: 'modelApi' }).limit({
    account: { remainingUsd, period: 'month' },
    backend: 'modelApi',
    provider: 'openrouter',
    source: 'openRouter',
    observedAt: NOW,
    windows: [],
  })
  const spending = scheduleLane('A')
  spending.estimatedHours = hours
  spending.resources.accountUsdPerHour = amount(ratePerHour)
  const owned = await bindEstimatorFleet(
    fleetFromHost(HOST, [spending], AS_OF),
    fleetIoFromSources(
      extensionFleetSources({
        inspect: () => undefined,
        readOwnedLimits: () => journal.ownedLimits?.() ?? [],
        currentOwner: () => ({
          accountId: 'work',
          generation: '1',
          providerId: 'openrouter',
          label: 'Work',
        }),
      }),
    ),
  )
  return { spending, owned }
}
describe('RVCM1173E owned observations', () => {
  it('keeps the newer observation in either arrival order (finding 1)', () => {
    for (const order of [
      [NOW, NOW - 1],
      [NOW - 1, NOW],
    ] as const) {
      const port = silentRecording()
      const scope = port.scopeLimits?.({ backend: 'museCode', accountId: 'a', generation: '1' })
      for (const observedAt of order) scope?.limit(input(observedAt, observedAt === NOW ? 0 : 100))
      const rows = port.ownedLimits?.() ?? []
      expect(rows).toHaveLength(1)
      expect(rows[0]?.snapshot.observedAt).toBe(NOW)
      expect(rows[0]?.snapshot.windows[0]?.usedPercent).toBe(0)
      expect(typeof rows[0]?.sequence).toBe('number')
    }
  })
  it('refuses an observation without a usable owner or sequence (ruling 1)', () => {
    const warn = vi.fn()
    const port = silentRecording(NOW, warn)
    const owner = { kind: 'account', id: 'a', providerId: 'meta', generation: '1' } as const
    port.limit({ ...input(NOW, 50), owner: { ...owner, id: '' }, sequence: 0 })
    port.limit({ ...input(NOW, 50), owner, sequence: -1 })
    port.limit({ ...input(NOW, 50), owner, sequence: 1.5 })
    expect(port.ownedLimits?.()).toEqual([])
    expect(warn).toHaveBeenCalled()
  })
  it('admits the exact-decimal boundary binary arithmetic refuses (finding 2)', async () => {
    expect(0.1 * 3 === 0.3).toBe(false)
    const { spending, owned } = await admitBoundary(0.1, 3, 0.3)
    expect(owned.context.facts.find((fact) => fact.unit === 'usd')).toMatchObject({
      remaining: '0.3',
    })
    expect(
      prepareEstimateSchedule([spending], owned.fleet, undefined, owned.context).run().finishHours,
    ).toBe(3)
  })
  it('keeps usd facts as exact decimal strings and rejects numeric money (finding 2)', () => {
    expect(
      estimateLimitFactSchema.safeParse({
        owner: { kind: 'account', id: 'a', providerId: 'openrouter', generation: '1' },
        metric: 'balance',
        unit: 'usd',
        used: null,
        limit: null,
        remaining: '0.3',
        window: { startsAt: null, resetsAt: null, periodSeconds: null, calendarPeriod: null },
        observedAt: '2026-10-06T12:00:00.000Z',
        observedBy: 'openRouter',
      }).success,
    ).toBe(true)
    expect(
      estimateLimitFactSchema.safeParse({
        owner: { kind: 'account', id: 'a', providerId: 'openrouter', generation: '1' },
        metric: 'balance',
        unit: 'usd',
        used: null,
        limit: null,
        remaining: 0.3,
        window: { startsAt: null, resetsAt: null, periodSeconds: null, calendarPeriod: null },
        observedAt: '2026-10-06T12:00:00.000Z',
        observedBy: 'openRouter',
      }).success,
    ).toBe(false)
  })
  it('publishes under the new generation after reauthentication on the same host (finding 5)', async () => {
    const port = silentRecording()
    let generation = '1'
    MuseCodeHost.usageScope = () => ({ accountId: 'default', generation })
    const handle = fakeMspHost(fakeInitializeResult)
    const host = new MuseCodeHost(handle.host, new FakeLogOutputChannel(), undefined, {}, port)
    try {
      handle.server.notify('usage/changed', changedUsage(100))
      await settle()
      // The reauthentication retires generation 1; the host is not replaced.
      generation = '2'
      handle.server.notify('usage/changed', changedUsage(200))
      await settle()
      const rows = port.ownedLimits?.() ?? []
      // Both generations stay readable as history, but the fresh observation
      // after the recheck carries the new generation, never the retired one.
      expect(rows).toHaveLength(2)
      expect(rows.find((row) => row.owner.generation === '1')?.snapshot.observedAt).toBe(100)
      expect(rows.find((row) => row.owner.generation === '2')?.snapshot.observedAt).toBe(200)
    } finally {
      MuseCodeHost.usageScope = undefined
      await host.close()
    }
  })
  it('reads only the current owner and marks retired providers unknown (finding 6)', () => {
    const port = silentRecording()
    port.scopeLimits?.({ backend: 'modelApi', accountId: 'a', generation: '1' }).limit({
      backend: 'modelApi',
      provider: 'openrouter',
      source: 'openRouter',
      observedAt: 100,
      windows: [{ id: 'window', usedPercent: 90, resetsAt: 200 }],
    })
    const rows = port.ownedLimits?.() ?? []
    expect(rows).toHaveLength(1)
    // Account B signs in and reports nothing: no live row is current, so the
    // provider reads as one explicit unknown row newer than A's stale row,
    // never as A's window.
    const unknown = currentOwnedLimitSnapshots(
      rows,
      { accountId: 'b', generation: '2' },
      { at: 150, newId: () => 'marker', client: 'test' },
    )
    expect(unknown).toHaveLength(1)
    expect(unknown[0]).toMatchObject({
      provider: 'openrouter',
      source: 'openRouter',
      windows: [],
    })
    expect(unknown[0]?.observedAt).toBeGreaterThan(100)
    // The current owner still reads its own live row, with no marker.
    const current = currentOwnedLimitSnapshots(
      rows,
      { accountId: 'a', generation: '1' },
      { at: 150, newId: () => 'marker', client: 'test' },
    )
    expect(current).toHaveLength(1)
    expect(current[0]?.windows).toHaveLength(1)
  })
  it('keeps the selected provider and registry label for unknown headless limits (finding 8)', async () => {
    const owners = {
      readSettings: () => Promise.resolve(resourceSettingsSchema.parse({})),
      listAccounts: () => Promise.resolve([{ id: 'work', label: 'Work' }]),
      currentOwner: () => ({
        accountId: 'work',
        generation: '1',
        providerId: 'openrouter',
      }),
      readOwnedLimits: () => Promise.resolve([]),
    }
    const fallback = await headlessFleetSources(owners).activeAccount()
    expect(fallback).toMatchObject({
      kind: 'registry',
      providerId: 'openrouter',
      accountId: 'work',
      label: 'Work',
    })
    // Live facts without a label still read with the registry's label.
    const port = silentRecording()
    port.scopeLimits?.({ backend: 'modelApi', accountId: 'work', generation: '1' }).limit({
      backend: 'modelApi',
      provider: 'openrouter',
      source: 'openRouter',
      observedAt: NOW,
      windows: [{ id: 'window', usedPercent: 10, resetsAt: NOW + 3_600_000, windowMins: 60 }],
    })
    const live = await headlessFleetSources({
      ...owners,
      readOwnedLimits: () => Promise.resolve(port.ownedLimits?.() ?? []),
    }).activeAccount()
    expect(live).toMatchObject({ kind: 'facts', label: 'Work' })
  })
  it('exports typed report fields without decoding sentences (report kinds)', () => {
    const owner = estimateAccountOwnerSchema.parse({
      kind: 'account',
      id: 'work',
      providerId: 'openrouter',
      generation: '1',
    })
    const [fact] = ESTIMATE_FACT_TRANSLATORS.observation({
      owner,
      observedAt: NOW,
      snapshot: {
        v: 1,
        type: 'limit',
        id: 'observation',
        at: NOW,
        day: '2026-10-06',
        timezoneOffsetMins: 0,
        client: 'test',
        backend: 'modelApi',
        provider: 'openrouter',
        source: 'openRouter',
        observedAt: NOW,
        windows: [],
        account: { usedUsd: usd(100), limitUsd: usd(100), remainingUsd: usd(0), period: 'month' },
      },
    })
    if (fact === undefined) throw new Error('expected a balance fact')
    const reported = reportFactsFromContext({
      facts: [fact],
      labels: [{ accountId: 'work', providerId: 'openrouter', label: 'Work' }],
    })
    expect(reported.facts).toEqual([
      {
        owner: { kind: 'account', id: 'work', providerId: 'openrouter', generation: '1' },
        metric: 'balance',
        unit: 'usd',
        used: '100',
        limit: '100',
        remaining: '0',
        window: { startsAt: null, resetsAt: null, periodSeconds: null, calendarPeriod: 'month' },
        observedAt: '2026-10-06T12:00:00.000Z',
        observedBy: 'openRouter',
      },
    ])
    expect(reported.labels).toEqual([
      { accountId: 'work', providerId: 'openrouter', label: 'Work' },
    ])
  })
})
