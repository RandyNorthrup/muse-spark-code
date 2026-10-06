import { describe, expect, it } from 'vitest'
import classes from '../../src/shared/machineClasses.json'
import {
  estimateGoalSchema,
  estimateInputsSchema,
  estimateRequestSchema,
  estimateSectionSchema,
  fleetSnapshotSchema,
  historyRecordSchema,
  machineClassesSchema,
  parseEstimateGoal,
  providerImageSchema,
  providerSizeSchema,
  provisionedServerSchema,
  type EstimateSourcesPort,
  type MachineClass,
  type EstimateRequest,
  type EstimateInputs,
  type CatalogPrice,
} from '../../src/shared/estimate'
import {
  ESTIMATE_CALIBRATION_MIN_SAMPLES,
  ESTIMATE_IDLE_TEARDOWN_MINUTES,
  ESTIMATE_LOCAL_BUDGET_LANES,
  ESTIMATE_LOCAL_BUDGET_MS,
  ESTIMATE_MARGINAL_FLOOR_HOURS,
  ESTIMATE_PRIOR_SIGMA,
  ESTIMATE_RUNS,
} from '../../src/shared/constants'
import { ESTIMATOR_AS_OF, FakeEstimateHistory, fakeFleet } from './helpers/estimator/fakes'
import { fakeEstimate, fakeHistoryRecord } from './helpers/estimator/fixtures'

describe('M117 frozen estimator contracts', () => {
  it.each([
    ['12', { kind: 'milestone', milestoneId: 'M12' }],
    ['m110A0', { kind: 'milestone', milestoneId: 'M110a0' }],
    ['M112:Q,U', { kind: 'lanes', milestoneId: 'M112', laneIds: ['Q', 'U'] }],
    ['pr:123', { kind: 'pullRequest', number: 123 }],
    ['issues:2,7', { kind: 'issues', numbers: [2, 7] }],
    ['label:good first issue', { kind: 'label', label: 'good first issue' }],
    ['release:0.16.0', { kind: 'release', release: '0.16.0' }],
  ])('parses goal %s without any lookup', (text, expected) => {
    expect(parseEstimateGoal(text)).toEqual(expected)
  })

  it.each([
    '',
    'M0',
    'pr:0',
    'pr:1.5',
    'pr:9007199254740992',
    'issues:1,1',
    'issues:',
    'M112:Q,Q',
    'M112:Q,',
    'label:',
    'release:../../a',
    'M112 --by tomorrow',
  ])('refuses ambiguous or malformed goal %s', (text) => {
    expect(parseEstimateGoal(text)).toBeUndefined()
  })

  it('rejects undeclared fields rather than retaining private data', () => {
    expect(
      estimateGoalSchema.safeParse({
        kind: 'milestone',
        milestoneId: 'M117',
        privateValue: 'untrusted extra',
      }).success,
    ).toBe(false)
    const record = fakeHistoryRecord()
    expect(historyRecordSchema.safeParse({ ...record, content: 'conversation text' }).success).toBe(
      false,
    )
    expect(
      historyRecordSchema.safeParse({ ...record, laneId: 'person@example.invalid' }).success,
    ).toBe(false)
  })

  it('keeps D97 tunables and provider-agnostic classes fixed', () => {
    expect([
      ESTIMATE_RUNS,
      ESTIMATE_CALIBRATION_MIN_SAMPLES,
      ESTIMATE_PRIOR_SIGMA,
      ESTIMATE_MARGINAL_FLOOR_HOURS,
      ESTIMATE_IDLE_TEARDOWN_MINUTES,
      ESTIMATE_LOCAL_BUDGET_MS,
      ESTIMATE_LOCAL_BUDGET_LANES,
    ]).toEqual([2000, 20, 0.5, 4, 30, 2000, 40])
    const parsed: MachineClass[] = machineClassesSchema.parse(classes)
    expect(parsed.map((entry) => entry.os)).toEqual(
      expect.arrayContaining(['linux', 'windows', 'macos']),
    )
    expect(parsed.map((entry) => entry.architecture)).toEqual(
      expect.arrayContaining(['x64', 'arm64']),
    )
    expect(parsed.some((entry) => entry.gpu)).toBe(true)
    expect(machineClassesSchema.safeParse([...classes, classes[0]]).success).toBe(false)
  })

  it('refuses over-capacity fleets, unknown references and duplicate identities', () => {
    const fleet = fakeFleet()
    fleet.machines[0]!.caps.slots = 1
    expect(fleetSnapshotSchema.safeParse(fleet).success).toBe(false)
    fleet.machines[0]!.caps.slots = 2
    fleet.slots[0]!.accountId = 'missing'
    expect(fleetSnapshotSchema.safeParse(fleet).success).toBe(false)
    fleet.slots[0]!.accountId = 'account-1'
    fleet.accounts.push(fleet.accounts[0]!)
    expect(fleetSnapshotSchema.safeParse(fleet).success).toBe(false)
  })

  it('refuses capacity above the governor and impossible CI occupancy', () => {
    const fleet = fakeFleet()
    fleet.machines[0]!.capacityByKind[0]!.slots = 3
    expect(fleetSnapshotSchema.safeParse(fleet).success).toBe(false)
    fleet.machines[0]!.capacityByKind[0]!.slots = 2
    fleet.ci[0]!.occupiedJobs = 3
    expect(fleetSnapshotSchema.safeParse(fleet).success).toBe(false)
    fleet.ci[0]!.occupiedJobs = 0
    delete fleet.ci[0]!.minutesRemaining
    expect(fleetSnapshotSchema.safeParse(fleet).success).toBe(true)
  })

  it.each([-1, NaN, Infinity])('refuses invalid resource quantities %s', (value) => {
    const fleet = fakeFleet()
    fleet.accounts[0]!.requestsPerMinute = value
    expect(fleetSnapshotSchema.safeParse(fleet).success).toBe(false)
  })

  it('preserves simultaneous account usage windows and rejects duplicate windows', () => {
    const fleet = fakeFleet()
    const limits = fleet.accounts[0]!.usageLimits!
    expect(limits.map((limit) => limit.id)).toEqual(['daily', 'weekly'])
    expect(fleet.slots.filter((slot) => slot.accountId === 'account-1')).toHaveLength(4)
    limits.push(limits[0]!)
    expect(fleetSnapshotSchema.safeParse(fleet).success).toBe(false)
    const lane = fakeEstimate().inputs.lanes[0]!
    lane.resources.accountUsdPerHour = -1
    expect(
      estimateInputsSchema.safeParse({ ...fakeEstimate().inputs, lanes: [lane] }).success,
    ).toBe(false)
  })

  it('requires explicit UTC inputs and preserves unknown source absence', () => {
    const request: EstimateRequest = fakeEstimate().inputs.request
    expect(
      estimateRequestSchema.safeParse({ ...request, asOf: '2026-10-06T12:00:00' }).success,
    ).toBe(false)
    expect(estimateRequestSchema.parse(request)).not.toHaveProperty('deadline')
  })

  it('requires one snapshot time and closed lane dependencies', () => {
    const inputs: EstimateInputs = fakeEstimate().inputs
    inputs.fleet.asOf = '2026-10-06T11:00:00.000Z'
    expect(estimateInputsSchema.safeParse(inputs).success).toBe(false)
    inputs.fleet.asOf = ESTIMATOR_AS_OF
    inputs.lanes[0]!.dependencies = ['missing']
    expect(estimateInputsSchema.safeParse(inputs).success).toBe(false)
    inputs.lanes[0]!.dependencies = [inputs.lanes[0]!.id]
    expect(estimateInputsSchema.safeParse(inputs).success).toBe(false)
  })

  it('refuses reversed history and preserves elapsed-time provenance', () => {
    const record = fakeHistoryRecord()
    expect(
      historyRecordSchema.safeParse({ ...record, finishedAt: '2026-10-04T00:00:00Z' }).success,
    ).toBe(false)
    expect(
      historyRecordSchema.parse({ ...record, durationBasis: 'gitElapsed' }).durationBasis,
    ).toBe('gitElapsed')
    expect(
      historyRecordSchema.safeParse({
        ...record,
        startedAt: '2026-10-05T10:00:00Z',
        finishedAt: '2026-10-05T10:00:00.000Z',
      }).success,
    ).toBe(true)
  })

  it('refuses inverted uncertainty, backwards schedules and unknown lanes', () => {
    const result = fakeEstimate()
    result.p90 = '2026-10-06T12:30:00.000Z'
    expect(estimateSectionSchema.safeParse(result).success).toBe(false)
    result.p90 = '2026-10-06T14:00:00.000Z'
    result.schedule[0]!.end = '2026-10-06T11:00:00.000Z'
    expect(estimateSectionSchema.safeParse(result).success).toBe(false)
    result.schedule[0]!.end = result.p50
    result.schedule[0]!.laneId = 'missing'
    expect(estimateSectionSchema.safeParse(result).success).toBe(false)
  })

  it('refuses a promise that agents shorten the critical path', () => {
    const result = fakeEstimate()
    result.limitingResource.moreAgentsHelp = true
    expect(estimateSectionSchema.safeParse(result).success).toBe(false)
  })

  it('requires honest sample labels at the calibration threshold', () => {
    const result = fakeEstimate()
    result.calibration[0]!.basis = 'fitted'
    expect(estimateSectionSchema.safeParse(result).success).toBe(false)
    result.calibration[0]!.samples = 20
    expect(estimateSectionSchema.safeParse(result).success).toBe(true)
    result.calibration[0]!.basis = 'uncalibratedPrior'
    expect(estimateSectionSchema.safeParse(result).success).toBe(false)
  })

  it('only accepts dated public HTTPS catalog prices', () => {
    const result = fakeEstimate()
    const price: CatalogPrice = {
      providerId: 'fake-provider',
      sizeId: 'small',
      hourlyUsd: 0.02,
      catalogUrl: 'https://catalog.invalid/sizes',
      catalogDate: '2026-10-06',
      publicCatalog: true,
    }
    const machine = result.setups[0]!.machines[0]!
    expect(
      estimateSectionSchema.safeParse({
        ...result,
        setups: [{ ...result.setups[0], machines: [{ ...machine, price }] }],
      }).success,
    ).toBe(true)
    for (const override of [
      { publicCatalog: false },
      { catalogDate: undefined },
      { catalogUrl: ['http', 'catalog.invalid/sizes'].join('://') },
    ]) {
      expect(
        estimateSectionSchema.safeParse({
          ...result,
          setups: [
            { ...result.setups[0], machines: [{ ...machine, price: { ...price, ...override } }] },
          ],
        }).success,
      ).toBe(false)
    }
  })

  it('projects provider results without payment or credential fields', () => {
    expect(
      providerSizeSchema.safeParse({ id: 'small', classId: 'linux-x64-small', hourlyUsd: -1 })
        .success,
    ).toBe(false)
    expect(
      providerImageSchema.safeParse({ id: 'image', os: 'linux', architecture: 'unknown' }).success,
    ).toBe(false)
    expect(
      provisionedServerSchema.safeParse({
        id: 'server',
        sizeId: 'small',
        imageId: 'image',
        state: 'running',
        payment: 'extra',
      }).success,
    ).toBe(false)
  })

  it('composes sources solely through injected portable ports', async () => {
    const estimate = fakeEstimate()
    const source: EstimateSourcesPort = {
      lanes: () => Promise.resolve(estimate.inputs.lanes),
      fleet: () => Promise.resolve(fakeFleet()),
      history: new FakeEstimateHistory(),
    }
    expect(await source.lanes(estimate.inputs.request.goal, ESTIMATOR_AS_OF)).toEqual(
      estimate.inputs.lanes,
    )
    expect(await source.fleet(ESTIMATOR_AS_OF)).toEqual(estimate.inputs.fleet)
    expect(await source.history.list()).toEqual([])
  })
})
