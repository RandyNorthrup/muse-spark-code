// M117 W: the lazy estimator bundle assembles a fully evidenced section
// from injected sources, deterministically, with an honest first wave.
// Repository default timeout; no skips.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { estimateSectionSchema, type EstimateInputs } from '../../src/shared/estimate'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import {
  createEstimatorRun,
  type EstimatorSourcePorts,
} from '../../src/host/estimator/estimatorEntry'
import { isEstimatorBundle } from '../../src/host/estimator/estimatorBundle'
import { ESTIMATOR_AS_OF, FakeEstimateStart } from './helpers/estimator/fakes'
import { fakeHistoryRecord, chainSnapshot } from './helpers/estimator/fixtures'
import { recommendationFixture } from './helpers/estimatorRecommendFixtures'
import * as simulation from '../../src/core/estimator/simulate'
import {
  amount,
  scheduleLane,
  scheduleFleet,
  simulationInputs,
} from './helpers/estimatorScheduleFixtures'

function ports(
  board = new FakeEstimateStart(),
): EstimatorSourcePorts & { boardInstance: FakeEstimateStart } {
  const instance = board
  const fleet = scheduleFleet(1)
  for (const machine of fleet.machines) machine.capacityByKind.push({ kind: 'contracts', slots: 1 })
  return {
    boardInstance: instance,
    snapshot: () => Promise.resolve(chainSnapshot()),
    fleet: () => Promise.resolve(structuredClone(fleet)),
    history: () => Promise.resolve([]),
    candidatePool: () => Promise.resolve(structuredClone(fleet)),
    board: () => instance,
    prices: () => {
      throw new Error('price lookup disabled in this test')
    },
    priceLookup: () => ({ enabled: false, networkAllowed: false, maxAgeMs: 0, catalogUrls: [] }),
  }
}

function request() {
  return {
    goal: { kind: 'milestone', milestoneId: 'M117' } as const,
    asOf: ESTIMATOR_AS_OF,
    fleet: 'current' as const,
    optimize: 'cost' as const,
  }
}

beforeEach(() => {
  setUiText(EN, BASE_LOCALE)
})
afterEach(() => {
  vi.restoreAllMocks()
  setUiText(EN, BASE_LOCALE)
})

describe('M117 estimator bundle assembly', () => {
  it('produces a fully evidenced section: chain, engines, disclosures, no risks', async () => {
    const run = createEstimatorRun(ports(), EN, BASE_LOCALE)
    const section = await run.estimate(request(), new AbortController().signal)
    // The internal parse already enforces exact disclosure coverage; the
    // outer parse proves the shipped shape round-trips.
    const parsed = estimateSectionSchema.parse(structuredClone(section))
    expect(parsed.criticalPath).toEqual(['M117:A', 'M117:B', 'M117:C'])
    expect(Date.parse(parsed.p90)).toBeGreaterThanOrEqual(Date.parse(parsed.p50))
    const kinds = new Set(parsed.calibration.map((row) => `${row.kind}:${row.machineClassId}`))
    expect(kinds.has('contracts:linux-x64-builder')).toBe(true)
    expect(kinds.has('core:linux-x64-builder')).toBe(true)
    for (const engine of [undefined, 'codex', 'claude', 'grok'] as const)
      expect(
        parsed.calibration.some(
          (row) => row.kind === 'core' && (row.engine ?? undefined) === engine,
        ),
      ).toBe(true)
    expect(parsed.risks ?? []).toEqual([])
    expect(parsed.setups.length).toBeGreaterThan(0)
  })
  it('fits new rental classes and searches their faster setup', async () => {
    const fixture = recommendationFixture(1)
    const rental = fixture.pool.machines.find((machine) => machine.source === 'rented')!
    Object.assign(rental, { classId: 'linux-x64-small', cores: 2, ramGiB: 4 })
    const source = ports()
    const snapshot = chainSnapshot()
    snapshot.lanes = fixture.inputs.lanes.map((lane) => ({
      lane: { ...lane, id: `M117:${lane.id}` },
    }))
    snapshot.milestones[0]!.laneIds = snapshot.lanes.map(({ lane }) => lane.id)
    source.snapshot = () => Promise.resolve(snapshot)
    source.fleet = () => Promise.resolve(fixture.inputs.fleet)
    source.candidatePool = () => Promise.resolve(fixture.pool)
    const result = await createEstimatorRun(source, EN, BASE_LOCALE).estimate(
      { ...request(), fleet: 'optimum', optimize: 'speed', seed: 'rental' },
      new AbortController().signal,
    )
    expect(result.calibration.some((row) => row.machineClassId === rental.classId)).toBe(true)
    const current = result.setups.find((setup) => setup.kind === 'current')!
    const fastest = result.setups.find((setup) => setup.kind === 'optimumSpeed')!
    expect(Date.parse(fastest.p90)).toBeLessThan(Date.parse(current.p90))
    expect(fastest.machines.some((machine) => machine.classId === rental.classId)).toBe(true)
  })
  it('searches a feasible minimum while retaining the current fleet refusal', async () => {
    const source = ports()
    const snapshot = chainSnapshot()
    snapshot.lanes = [
      {
        lane: scheduleLane('M117:A', {
          resources: {
            ...scheduleLane('M117:A').resources,
            slots: amount(2),
          },
        }),
      },
    ]
    snapshot.milestones[0]!.laneIds = ['M117:A']
    const fleet = scheduleFleet(1)
    const pool = structuredClone(fleet)
    const extra = {
      ...structuredClone(scheduleFleet(2).machines[0]!),
      id: 'extra',
      source: 'node' as const,
    }
    pool.machines.push(extra)
    pool.slots.push(
      ...scheduleFleet(2).slots.map((slot) => ({
        ...slot,
        id: `extra-${slot.id}`,
        machineId: extra.id,
      })),
    )
    source.snapshot = () => Promise.resolve(snapshot)
    source.fleet = () => Promise.resolve(fleet)
    source.candidatePool = () => Promise.resolve(pool)
    const result = await createEstimatorRun(source, EN, BASE_LOCALE).estimate(
      { ...request(), fleet: 'minimum', deadline: '2026-10-09T12:00:00.000Z' },
      new AbortController().signal,
    )
    expect(result.currentRefusal).toContain('unschedulable:M117:A')
    expect(result.setups.some((setup) => setup.kind === 'minimumP90' && setup.meetsDeadline)).toBe(
      true,
    )
    expect(result.setups.some((setup) => setup.kind === 'current')).toBe(false)
    expect(result.forecastFleet?.machines.some((machine) => machine.id === 'extra')).toBe(true)
    estimateSectionSchema.parse(result)
  })
  it('propagates engine faults instead of classifying them as infeasible fleets', async () => {
    const real = simulation.simulateEstimate
    let calls = 0
    vi.spyOn(simulation, 'simulateEstimate').mockImplementation((...args) => {
      if (++calls > 1) throw new Error('Estimate failed: missing-fit')
      return real(...args)
    })
    await expect(
      createEstimatorRun(ports(), EN, BASE_LOCALE).estimate(
        request(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('missing-fit')
  })
  it('retains named unknown supply and approximate placement qualifications', async () => {
    const source = ports()
    const fleet = scheduleFleet(1)
    fleet.machines[0]!.capacityByKind.push({ kind: 'contracts', slots: 1 })
    delete fleet.accounts[0]!.usageLimits
    source.fleet = source.candidatePool = () => Promise.resolve(fleet)
    const real = simulation.simulateEstimate
    vi.spyOn(simulation, 'simulateEstimate').mockImplementation((...args) => {
      const result = real(...args)
      result.unknownLimits.push('M117:A:account-selection-approximate')
      return result
    })
    const result = await createEstimatorRun(source, EN, BASE_LOCALE).estimate(
      request(),
      new AbortController().signal,
    )
    expect(result.qualifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          setup: 'current',
          unknownLimits: expect.arrayContaining([
            'account-1:usageLimits',
            'M117:A:account-selection-approximate',
          ]),
        }),
      ]),
    )
  })
  it('discloses duration, review and redesign parameters using their own evidence', async () => {
    const source = ports()
    source.history = () =>
      Promise.resolve(
        Array.from({ length: 20 }, (_, index) => ({
          ...fakeHistoryRecord(`M117:H${String(index)}`),
          review: { status: 'unknown' },
        })),
      )
    const result = await createEstimatorRun(source, EN, BASE_LOCALE).estimate(
      request(),
      new AbortController().signal,
    )
    const index = result.calibration.findIndex(
      (row) => row.kind === 'core' && row.engine === undefined,
    )
    const disclosure = (parameter: string) =>
      result.disclosures.find((row) => row.path === `/calibration/${String(index)}/${parameter}`)
    expect(disclosure('mu')).toMatchObject({ basis: 'calibration', samples: 20 })
    expect(disclosure('reviewRoundRate')).toMatchObject({ basis: 'assumption', samples: 0 })
    expect(disclosure('redesignRisk')).toMatchObject({ basis: 'assumption', samples: 0 })
  })
  it('names stale-base lanes as risks without pricing them', async () => {
    const source = ports()
    const aged = chainSnapshot()
    for (const entry of aged.lanes) entry.lane.baseAsOf = '2026-09-01T12:00:00.000Z'
    source.snapshot = () => Promise.resolve(aged)
    const run = createEstimatorRun(source, EN, BASE_LOCALE)
    const section = await run.estimate(request(), new AbortController().signal)
    expect(section.risks).toEqual([
      { laneId: 'M117:A', kind: 'staleBase' },
      { laneId: 'M117:B', kind: 'staleBase' },
      { laneId: 'M117:C', kind: 'staleBase' },
    ])
    estimateSectionSchema.parse(structuredClone(section))
  })
  it('estimates the same bytes twice for the same inputs', async () => {
    const run = createEstimatorRun(ports(), EN, BASE_LOCALE)
    const signal = new AbortController().signal
    const first = await run.estimate(request(), signal)
    const second = await run.estimate(request(), signal)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
  it('starts the audited contract wave through the injected board', async () => {
    const source = ports()
    const run = createEstimatorRun(source, EN, BASE_LOCALE)
    const section = await run.estimate(request(), new AbortController().signal)
    const input: EstimateInputs = simulationInputs(section.inputs.lanes, section.inputs.fleet)
    expect(await run.startWave(input)).toEqual(['M117:A'])
    expect(source.boardInstance.audits).toEqual([['M117:A']])
  })
  it('formats catalog prices with exact money, ceiling only at display', () => {
    const run = createEstimatorRun(ports(), EN, BASE_LOCALE)
    expect(
      run.price({
        providerId: 'p',
        sizeId: 's',
        hourlyUsd: 0.5,
        catalogUrl: 'https://provider.invalid/rates',
        catalogDate: '2026-10-01',
        publicCatalog: true,
      }),
    ).toContain('0.50')
    expect(run.provisionWaiting).toBe('M117-P-M109-provider')
  })
  it('recognizes its own bundle shape', () => {
    expect(isEstimatorBundle({ createEstimatorRun })).toBe(true)
    expect(isEstimatorBundle({})).toBe(false)
  })
})
