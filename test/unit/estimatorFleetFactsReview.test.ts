import { buildSync } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { fleetSnapshotSchema } from '../../src/shared/estimate'
import { describe, expect, it } from 'vitest'
import {
  applyFleetBinding,
  bindEstimatorFleet,
  extensionFleetSources,
  fleetIoFromSources,
  headlessFleetSources,
  ownedSubscriptionUsage,
} from '../../src/host/estimator/fleetBinding'
import { estimatorSourcePorts, fleetFromHost } from '../../src/host/estimator/localFleet'
import { type OwnedLimitInput, type UsageRecording } from '../../src/core/usage/recording'
import { ownedRecording } from './helpers/ownedRecording'
import type { EstimateLane } from '../../src/shared/estimate'
import { prepareEstimateSchedule, EstimateSchedulingError } from '../../src/core/estimator/schedule'
import { createEstimatorRun } from '../../src/host/estimator/estimatorEntry'
import { EN } from '../../src/shared/l10n/en'
import { resourceSettingsSchema } from '../../src/shared/resources'
import { buildPlanSnapshot } from '../../src/core/estimator/planSnapshot'
import { parseEstimateGoal } from '../../src/shared/estimate'
import { USAGE_JOURNAL_VERSION } from '../../src/shared/constants'
import { legacyUsdSchema, type UsdAmount } from '../../src/shared/usdSchema'
import { resolveLimitContext } from '../../src/core/estimator/limitContext'
import { simulateEstimate } from '../../src/core/estimator/simulate'
import { estimateFailureText } from '../../src/runtime/estimator/command'
import { renderLimitNote } from '../../src/core/estimator/limitText'
import {
  amount,
  fixedDurationPort,
  scheduleLane,
  simulationInputs,
} from './helpers/estimatorKindScheduleFixtures'
import type { UsageLimitSnapshot } from '../../src/shared/usageJournal'
const AS_OF = '2026-10-06T12:00:00.000Z'
const NOW = Date.parse(AS_OF)
const HOST = { platform: 'linux', arch: 'x64', cores: 4, ramGiB: 8 }
const usd = (value: number): UsdAmount => legacyUsdSchema.parse(value)
// The plan behind the exhausted-balance run: real plan text, never invented lanes.
const EXHAUSTED_PLAN = `## 6. Milestones

### M117 — Capacity work (2026-10-06)

**Status 2026-10-06: building.**

- **Goal.** Ship capacity.
- **Depends on.** Nothing new.
- **Gates.** The full gate.

| Lane | Items | Files it owns | Starts | Hours |
| ---- | ----- | ------------- | ------ | ----- |
| 0 | all | \`src/a.ts\` | First | 8 |
`

function recording() {
  return ownedRecording(NOW).port
}
function observation(
  source: UsageLimitSnapshot['source'] = 'museCode',
  overrides?: Partial<Pick<OwnedLimitInput, 'windows' | 'account' | 'observedAt'>>,
): OwnedLimitInput {
  return {
    backend: source === 'museCode' ? 'museCode' : 'modelApi',
    provider: source === 'museCode' ? 'museCode' : 'openrouter',
    source,
    observedAt: NOW,
    windows: [{ id: 'weekly', usedPercent: 90, resetsAt: NOW + 3_600_000 }],
    ...overrides,
  }
}
async function bindWorkFleet(lane: EstimateLane, port: UsageRecording) {
  return await bindEstimatorFleet(
    fleetFromHost(HOST, [lane], AS_OF),
    fleetIoFromSources(
      extensionFleetSources({
        inspect: () => undefined,
        currentOwner: () => ({
          accountId: 'work',
          generation: '1',
          providerId: 'openrouter',
          label: 'Work',
        }),
        readOwnedLimits: () => port.ownedLimits?.() ?? [],
      }),
    ),
  )
}
const zoneProbe =
  buildSync({
    entryPoints: ['test/unit/helpers/estimatorZoneProbe.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    minify: true,
    absWorkingDir: process.cwd(),
  }).outputFiles[0]?.text ?? ''

describe('RVCM1173D structured facts in the real fleet and scheduler', () => {
  it('delays known percentage demand with unknown renewal period', async () => {
    const lane = scheduleLane('A')
    lane.resources.accountPercentPerHour = amount(60)
    const bound = await bindEstimatorFleet(fleetFromHost(HOST, [lane], AS_OF), {
      activeAccount: () => ({
        kind: 'limits',
        generation: '1',
        providerId: 'meta',
        accountId: 'private-id',
        label: 'Work',
        snapshot: {
          planWindows: { weekly: { usedPercent: 90, resetAt: '2026-10-06T13:00:00.000Z' } },
        },
      }),
    })
    const { fleet, context } = bound
    const result = prepareEstimateSchedule([lane], fleet, undefined, context).run()
    expect(result.schedule[0]?.start).toBe('2026-10-06T12:50:00.000Z')
    expect(result.schedule[0]?.end).toBe('2026-10-06T13:50:00.000Z')
    expect(result.unknownLimits.map((note) => renderLimitNote(note)).join(' ')).toContain(
      'Future refill period and rate unknown: Work/percent',
    )
    expect(result.unknownLimits.map((note) => renderLimitNote(note)).join(' ')).not.toContain(
      'demand of these lanes unknown',
    )
    expect(bound.context.facts.find((fact) => fact.owner.kind === 'account')).toMatchObject({
      remaining: 10,
      window: { periodSeconds: null },
    })
  })
  it.each(['museCode', 'openRouter', 'headers', 'chatgpt'] as const)(
    'enforces a known exhausted balance reported by %s',
    async (source) => {
      const port = recording()
      const observed = observation(source, {
        windows: [],
        account: { usedUsd: usd(100), limitUsd: usd(100), remainingUsd: usd(0), period: 'month' },
      })
      port
        .scopeLimits?.({ backend: observed.backend, accountId: 'private-id', generation: '1' })
        .limit(observed)
      const lane = scheduleLane('A')
      lane.resources.accountUsdPerHour = amount(1)
      const { fleet, context } = await bindEstimatorFleet(
        fleetFromHost(HOST, [lane], AS_OF),
        fleetIoFromSources(
          extensionFleetSources({
            inspect: () => undefined,
            currentOwner: () => ({
              accountId: 'private-id',
              generation: '1',
              providerId: source === 'museCode' ? 'meta' : 'openrouter',
              label: 'Work',
            }),
            readOwnedLimits: () => port.ownedLimits?.() ?? [],
          }),
        ),
      )
      expect(context.facts.find((fact) => fact.unit === 'usd')).toMatchObject({
        remaining: '0',
        used: '100',
        limit: '100',
      })
      expect(() => prepareEstimateSchedule([lane], fleet, undefined, context).run()).toThrow(
        'unschedulable:A',
      )
    },
  )
  it('retains partial allowance with unknown limit and reset without inventing renewal', async () => {
    const port = recording()
    const observed = observation('openRouter', {
      windows: [],
      account: { remainingUsd: usd(1), period: 'unknown' },
    })
    port.scopeLimits?.({ backend: 'modelApi', accountId: 'work', generation: '1' }).limit(observed)
    const lane = scheduleLane('A')
    lane.resources.accountUsdPerHour = amount(1)
    const { fleet, context } = await bindWorkFleet(lane, port)
    expect(prepareEstimateSchedule([lane], fleet, undefined, context).run().finishHours).toBe(1)
    const longer = { ...lane, estimatedHours: 2 }
    expect(() => prepareEstimateSchedule([longer], fleet, undefined, context).run()).toThrow(
      'unschedulable:A',
    )
  })
  it('does not reuse account A observations after switching account or sign-in generation', async () => {
    const port = recording()
    const old = port.scopeLimits?.({ backend: 'museCode', accountId: 'a', generation: '1' })
    const observed = observation()
    observed.windows[0]!.usedPercent = 100
    old?.limit(observed)
    let owner = { accountId: 'a', generation: '1', label: 'Work' }
    const sources = extensionFleetSources({
      inspect: () => undefined,
      currentOwner: () => owner,
      readOwnedLimits: () => port.ownedLimits?.() ?? [],
      readUsage: () => Promise.resolve(undefined),
    })
    const lane = scheduleLane('A')
    const base = fleetFromHost(HOST, [lane], AS_OF)
    expect(
      prepareEstimateSchedule(
        [lane],
        await applyFleetBinding(base, fleetIoFromSources(sources)),
      ).run().schedule[0]?.start,
    ).toBe('2026-10-06T13:00:00.000Z')
    for (const next of [
      { accountId: 'b', generation: '1', label: 'Home' },
      { accountId: 'a', generation: '2', label: 'Work' },
    ]) {
      owner = next
      old?.limit(observed) // A retired host may still deliver; ownership remains A/1.
      const { fleet, context } = await bindEstimatorFleet(base, fleetIoFromSources(sources))
      expect(fleet.accounts[0]?.availableAt).toBeUndefined()
      expect(
        prepareEstimateSchedule([lane], fleet, undefined, context).run().schedule[0]?.start,
      ).toBe(AS_OF)
      expect(
        prepareEstimateSchedule([lane], fleet, undefined, context)
          .run()
          .unknownLimits.map((note) => renderLimitNote(note))
          .join(' '),
      ).toContain('Unknown: limits unread')
    }
    port.scopeLimits?.({ backend: 'museCode', accountId: 'a', generation: '2' }).limit(observed)
    expect(
      prepareEstimateSchedule(
        [lane],
        await applyFleetBinding(base, fleetIoFromSources(sources)),
      ).run().schedule[0]?.start,
    ).toBe('2026-10-06T13:00:00.000Z')
  })
  it('does not reassign a usage read that overlaps a sign-in change', async () => {
    let generation = '1'
    const sources = extensionFleetSources({
      inspect: () => undefined,
      currentOwner: () => ({ accountId: 'a', generation }),
      readUsage: () => {
        generation = '2'
        return Promise.resolve({
          owner: { kind: 'account', id: 'a', providerId: 'meta', generation: '1' },
          snapshot: {
            observedAtMs: NOW,
            tier: 'captured',
            window: { usedPercent: 100, resetsAtMs: NOW + 3_600_000, windowDurationMins: 300 },
            weekly: { usedPercent: 20, resetsAtMs: NOW + 86_400_000 },
          },
        })
      },
    })
    expect(await sources.activeAccount()).toMatchObject({ kind: 'registry' })
  })
  it('returns byte-identical bound forecasts in two ambient time zones without a seed', () => {
    expect(zoneProbe).not.toBe('')
    const forecasts = ['Asia/Kolkata', 'Etc/GMT+12'].map((TZ) => {
      const child = spawnSync(process.execPath, [], {
        input: zoneProbe,
        encoding: 'utf8',
        env: { ...process.env, TZ, RLM117_ZONE_PROBE_AS_OF: AS_OF },
      })
      expect(child.status, child.stderr).toBe(0)
      return child.stdout
    })
    expect(forecasts[0]).toBe(forecasts[1])
    expect(forecasts[0]).not.toContain('Unknown:')
  })
  it('preserves typed scheduling refusals and hides raw I/O errors', () => {
    expect(estimateFailureText(new EstimateSchedulingError('unschedulable:A'))).toContain(
      'unschedulable:A',
    )
    const lane = scheduleLane('A')
    lane.resources.accountRequestsPerHour = {
      status: 'unknown',
      value: null,
      basis: 'unknown',
      samples: 0,
      uncertainty: { kind: 'unknown' },
    }
    const fleet = fleetFromHost(HOST, [lane], AS_OF)
    fleet.accounts[0]!.requestsPerMinute = 1
    try {
      prepareEstimateSchedule([lane], fleet).run()
      throw new Error('expected refusal')
    } catch (error: unknown) {
      expect(estimateFailureText(error)).toContain('unknown-demand:A:requests')
    }
    expect(estimateFailureText(new Error('/private/credential-owner'))).not.toContain('/private')
  })
  it('uses labels in unknowns and blocked diagnostics, never account ids', async () => {
    const lane = scheduleLane('A')
    const base = fleetFromHost(HOST, [lane], AS_OF)
    const { fleet, context } = await bindEstimatorFleet(base, {
      activeAccount: () => ({
        kind: 'registry',
        accountId: 'team-private-id',
        providerId: 'meta',
        label: 'Work',
      }),
    })
    const text = prepareEstimateSchedule([lane], fleet, undefined, context)
      .run()
      .unknownLimits.map((note) => renderLimitNote(note))
      .join(' ')
    expect(text).toContain('Work')
    expect(text).not.toContain('team-private-id')
    try {
      await applyFleetBinding(base, {
        activeAccount: () => ({
          kind: 'limits',
          generation: '1',
          accountId: 'team-private-id',
          providerId: 'meta',
          label: 'Work',
          snapshot: { blocked: { reason: 'quota', resetAt: null } },
        }),
      })
      throw new Error('expected refusal')
    } catch (error: unknown) {
      const rendered = estimateFailureText(error)
      expect(rendered).toContain('Work')
      expect(rendered).not.toContain('team-private-id')
    }
  })
  it('replays the complete owned facts from persisted forecast evidence', async () => {
    const port = recording()
    const observed = observation('openRouter', {
      windows: [],
      account: { remainingUsd: usd(1), period: 'unknown' },
    })
    port.scopeLimits?.({ accountId: 'work', generation: '1', backend: 'modelApi' }).limit(observed)
    const lane = scheduleLane('A')
    lane.resources.accountUsdPerHour = amount(1)
    const bound = await bindWorkFleet(lane, port)
    const serialized = JSON.stringify(bound.fleet)
    const persisted = fleetSnapshotSchema.parse(JSON.parse(serialized))
    expect(resolveLimitContext(persisted)).toEqual(bound.context)
    const input = simulationInputs([lane], persisted)
    expect(simulateEstimate(input, fixedDurationPort)).toEqual(
      simulateEstimate(input, fixedDurationPort, bound.context),
    )
  })
  it('carries exhausted balances through the real panel and headless engine ports', async () => {
    const port = recording()
    const observed = observation('openRouter', {
      windows: [],
      account: { remainingUsd: usd(0), period: 'month' },
    })
    port.scopeLimits?.({ accountId: 'work', generation: '1', backend: 'modelApi' }).limit(observed)
    const owners = {
      currentOwner: () => ({
        accountId: 'work',
        generation: '1',
        providerId: 'openrouter',
        label: 'Work',
      }),
      readOwnedLimits: () => port.ownedLimits?.() ?? [],
    }
    for (const sources of [
      extensionFleetSources({ inspect: () => undefined, ...owners }),
      headlessFleetSources({
        readSettings: () => Promise.resolve(resourceSettingsSchema.parse({})),
        listAccounts: () => Promise.resolve([{ id: 'work', label: 'Work' }]),
        ...owners,
      }),
    ]) {
      const goal = parseEstimateGoal('M117')
      if (goal === undefined) throw new Error('unparseable goal: M117')
      const snapshot = buildPlanSnapshot(EXHAUSTED_PLAN, goal, AS_OF, { branches: [] })
      for (const row of snapshot.lanes) row.lane.resources.accountUsdPerHour = amount(1)
      const ports = estimatorSourcePorts(
        () => ({ enabled: false, networkAllowed: false, maxAgeMs: 0, catalogUrls: [] }),
        () => Promise.resolve(snapshot),
        fleetIoFromSources(sources),
      )
      try {
        await createEstimatorRun(ports, EN, 'en').estimate(
          {
            goal: { kind: 'milestone', milestoneId: 'M117' },
            asOf: AS_OF,
            fleet: 'current',
            optimize: 'cost',
          },
          new AbortController().signal,
        )
        throw new Error('expected refusal')
      } catch (error: unknown) {
        expect(estimateFailureText(error)).toContain('unschedulable:')
      }
    }
  })
  it('proves RPC ownership using the recorded generation and complete numeric frame', () => {
    const port = recording()
    const usage = {
      observedAtMs: NOW,
      tier: 'captured',
      window: { usedPercent: 100, resetsAtMs: NOW + 3_600_000, windowDurationMins: 300 },
      weekly: { usedPercent: 20, resetsAtMs: NOW + 86_400_000 },
    }
    const observed = observation(undefined, {
      windows: [
        { id: 'window', usedPercent: 100, resetsAt: usage.window.resetsAtMs, windowMins: 300 },
        { id: 'weekly', usedPercent: 20, resetsAt: usage.weekly.resetsAtMs },
      ],
    })
    const scope = { accountId: 'work', generation: '1', backend: 'museCode' as const }
    const scoped = port.scopeLimits?.(scope)
    scope.generation = '2'
    scoped?.limit(observed)
    expect(port.ownedLimits?.()[0]?.owner.generation).toBe('1')
    expect(
      ownedSubscriptionUsage(usage, port.ownedLimits?.() ?? [], {
        accountId: 'work',
        generation: '2',
      }),
    ).toBeUndefined()
    expect(
      ownedSubscriptionUsage(usage, port.ownedLimits?.() ?? [], {
        accountId: 'work',
        generation: '1',
      })?.owner.generation,
    ).toBe('1')
    const next = port.scopeLimits?.({ accountId: 'work', generation: '2', backend: 'museCode' })
    observed.windows[0]!.usedPercent = 10
    next?.limit(observed)
    expect(
      ownedSubscriptionUsage(usage, port.ownedLimits?.() ?? [], {
        accountId: 'work',
        generation: '2',
      }),
    ).toBeUndefined()
  })
  it('selects the observed account provider instead of the newest unrelated vendor', async () => {
    const port = recording()
    const scope = port.scopeLimits?.({ accountId: 'work', generation: '1', backend: 'modelApi' })
    const router = observation('openRouter', {
      windows: [],
      account: { remainingUsd: usd(0), period: 'month' },
    })
    scope?.limit(router)
    scope?.limit({
      ...router,
      provider: 'meta',
      source: 'headers',
      observedAt: NOW + 1,
      account: { remainingUsd: usd(100), period: 'month' },
    })
    const lane = scheduleLane('A')
    lane.resources.accountUsdPerHour = amount(1)
    const bound = await bindWorkFleet(lane, port)
    expect(bound.fleet.accounts[0]?.providerId).toBe('openrouter')
    expect(() => prepareEstimateSchedule([lane], bound.fleet).run()).toThrow('unschedulable:A')
  })
  it('refuses malformed ownership metadata by source', async () => {
    const sources = extensionFleetSources({
      inspect: () => undefined,
      currentOwner: () => ({ accountId: '?invalid', generation: '1' }),
    })
    await expect(sources.activeAccount()).rejects.toThrow('fleet-account-invalid: owner')
  })
  it('names the corrupt usage owner for invalid epoch timestamps', async () => {
    const observed = observation()
    observed.windows[0]!.resetsAt = Number.MAX_SAFE_INTEGER
    const sources = extensionFleetSources({
      inspect: () => undefined,
      currentOwner: () => ({ accountId: 'default', generation: '1' }),
      readOwnedLimits: () => [
        {
          owner: { kind: 'account' as const, id: 'default', providerId: 'meta', generation: '1' },
          sequence: 0,
          snapshot: {
            ...observed,
            account: undefined,
            v: USAGE_JOURNAL_VERSION,
            type: 'limit',
            id: 'test',
            at: NOW,
            day: '2026-10-06',
            timezoneOffsetMins: 0,
            client: 'test',
          },
        },
      ],
    })
    try {
      await sources.activeAccount()
      throw new Error('expected refusal')
    } catch (error: unknown) {
      expect(estimateFailureText(error)).toContain('fleet-account-invalid: usage-changed')
    }
  })
})
