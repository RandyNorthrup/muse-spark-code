// M117 W: the lazy estimator bundle assembles a fully evidenced section
// from injected sources, deterministically, with an honest first wave.
// Repository default timeout; no skips.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import dags from '../fixtures/estimator/dags.json'
import {
  estimateLaneSchema,
  estimateSectionSchema,
  type EstimateInputs,
} from '../../src/shared/estimate'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import {
  createEstimatorRun,
  type EstimatorSourcePorts,
} from '../../src/host/estimator/estimatorEntry'
import { isEstimatorBundle } from '../../src/host/estimator/estimatorBundle'
import type { EstimateGoalSnapshot } from '../../src/core/estimator/goal'
import { ESTIMATOR_AS_OF, FakeEstimateStart } from './helpers/estimator/fakes'
import { scheduleFleet, simulationInputs } from './helpers/estimatorScheduleFixtures'

function chainSnapshot(): EstimateGoalSnapshot {
  const chain = dags.find((fixture) => fixture.name === 'chain')
  if (chain === undefined) throw new Error('missing chain fixture')
  const lanes = chain.lanes.map((input, index) => ({
    lane: estimateLaneSchema.parse({
      ...input,
      id: `M117:${input.id}`,
      kind: index === 0 ? 'contracts' : input.kind,
      dependencies: input.dependencies.map((id) => `M117:${id}`),
    }),
  }))
  return {
    asOf: ESTIMATOR_AS_OF,
    lanes,
    milestones: [{ id: 'M117', laneIds: lanes.map(({ lane }) => lane.id) }],
    pullRequests: [],
    issues: [],
    releases: [],
    rigs: [],
  }
}

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
