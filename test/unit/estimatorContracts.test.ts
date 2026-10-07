import { describe, expect, it } from 'vitest'
import classes from '../../src/shared/machineClasses.json'
import {
  estimateGoalSchema,
  estimateInputsSchema,
  estimateLaneSchema,
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
import { fakeDisclosures, fakeEstimate, fakeHistoryRecord } from './helpers/estimator/fixtures'

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
    'labels',
    'releases',
    'pr',
    'issues',
    'M112Q,U',
    'M112:Q:U',
    'release:../../a',
    'release:tag:other',
    'M112 --by tomorrow',
  ])('refuses ambiguous or malformed goal %s', (text) => {
    expect(parseEstimateGoal(text)).toBeUndefined()
  })

  it('applies the same strict goal names to structured requests', () => {
    expect(
      estimateGoalSchema.safeParse({ kind: 'lanes', milestoneId: 'M117', laneIds: ['G:extra'] })
        .success,
    ).toBe(false)
    expect(estimateGoalSchema.safeParse({ kind: 'release', release: 'tag:extra' }).success).toBe(
      false,
    )
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
    lane.resources.accountUsdPerHour.value = -1
    expect(
      estimateInputsSchema.safeParse({ ...fakeEstimate().inputs, lanes: [lane] }).success,
    ).toBe(false)
  })

  it('distinguishes renewed quotas and preserves rolling percentage windows', () => {
    const fleet = fakeFleet()
    const window = fleet.accounts[0]!.usageLimits![0]!
    const larger = structuredClone(fleet)
    larger.accounts[0]!.usageLimits![0]!.allowance = 10_000
    expect(fleetSnapshotSchema.parse(larger)).not.toEqual(fleetSnapshotSchema.parse(fleet))
    expect(window).toMatchObject({ kind: 'calendar', period: 'day', timeZone: 'UTC' })
    fleet.accounts[0]!.usageLimits!.push({
      id: 'subscription',
      kind: 'rolling',
      periodSeconds: 18_000,
      timeZone: 'America/Los_Angeles',
      unit: 'percent',
      remaining: 40,
      allowance: 100,
      resetsAt: '2026-10-06T17:00:00.000Z',
    })
    expect(fleetSnapshotSchema.parse(fleet).accounts[0]!.usageLimits![2]).toMatchObject({
      kind: 'rolling',
      unit: 'percent',
      periodSeconds: 18_000,
    })
  })

  it('requires renewal metadata and validates quota bounds', () => {
    const fleet = fakeFleet()
    const window = fleet.accounts[0]!.usageLimits![0]!
    for (const field of ['kind', 'period', 'allowance', 'resetsAt', 'timeZone']) {
      const incomplete = Object.fromEntries(Object.entries(window).filter(([key]) => key !== field))
      expect(
        fleetSnapshotSchema.safeParse({
          ...fleet,
          accounts: [{ ...fleet.accounts[0], usageLimits: [incomplete] }],
        }).success,
      ).toBe(false)
    }
    for (const change of [
      { remaining: 1001 },
      { timeZone: 'no-such-zone' },
      { unit: 'percent', allowance: 101, remaining: 40 },
    ]) {
      expect(
        fleetSnapshotSchema.safeParse({
          ...fleet,
          accounts: [{ ...fleet.accounts[0], usageLimits: [{ ...window, ...change }] }],
        }).success,
      ).toBe(false)
    }
    const rolling = {
      id: 'rolling',
      kind: 'rolling',
      unit: 'percent',
      allowance: 100,
      remaining: 40,
      timeZone: 'UTC',
      resetsAt: window.resetsAt,
    }
    expect(
      fleetSnapshotSchema.safeParse({
        ...fleet,
        accounts: [{ ...fleet.accounts[0], usageLimits: [rolling] }],
      }).success,
    ).toBe(false)
  })

  it('preserves per-volume disk headroom and peak versus retained demand', () => {
    const fleet = fakeFleet()
    const disk = fleet.machines[0]!.disks[0]!
    expect(disk).toMatchObject({ status: 'known', headroomBytes: 12 * 1024 ** 3 })
    const lane = fakeEstimate().inputs.lanes[0]!
    lane.resources.disk[0]!.peakBytes = {
      status: 'known',
      value: 8 * 1024 ** 3,
      basis: 'assumption',
      samples: 0,
      uncertainty: { kind: 'unknown' },
    }
    lane.resources.disk[0]!.steadyBytes = {
      status: 'known',
      value: 4 * 1024 ** 3,
      basis: 'assumption',
      samples: 0,
      uncertainty: { kind: 'unknown' },
    }
    expect(estimateLaneSchema.parse(lane).resources.disk[0]).toMatchObject({
      role: 'workspace',
      peakBytes: { value: 8 * 1024 ** 3 },
      steadyBytes: { value: 4 * 1024 ** 3 },
    })
    // Two valid lanes exceed the same volume's headroom; S can now detect it.
    expect(lane.resources.disk[0]!.peakBytes.value * 2).toBeGreaterThan(12 * 1024 ** 3)
    fleet.machines[0]!.disks = [
      { status: 'unknown', volumeId: 'primary', roles: ['workspace', 'temp', 'state'] },
    ]
    expect(fleetSnapshotSchema.parse(fleet).machines[0]!.disks[0]).toEqual(
      fleet.machines[0]!.disks[0],
    )
    fleet.machines[0]!.disks.push(
      { status: 'unknown', volumeId: 'worktrees', roles: ['worktrees'] },
      { status: 'unknown', volumeId: 'logs', roles: ['logs'] },
      { status: 'unknown', volumeId: 'data', roles: ['data'] },
    )
    expect(fleetSnapshotSchema.parse(fleet).machines[0]!.disks).toHaveLength(4)
  })

  it('refuses inconsistent disk headroom, aliases and demand', () => {
    const fleet = fakeFleet()
    const disk = fleet.machines[0]!.disks[0]!
    if (disk.status !== 'known') throw new Error('Known fixture required')
    disk.headroomBytes++
    expect(fleetSnapshotSchema.safeParse(fleet).success).toBe(false)
    disk.headroomBytes--
    for (const change of [
      { freeBytes: disk.totalBytes + 1, headroomBytes: disk.totalBytes + 1 - disk.floorBytes },
      { floorBytes: disk.totalBytes + 1, headroomBytes: 0 },
    ]) {
      expect(
        fleetSnapshotSchema.safeParse({
          ...fleet,
          machines: [
            { ...fleet.machines[0], disks: [{ ...disk, ...change }] },
            ...fleet.machines.slice(1),
          ],
        }).success,
      ).toBe(false)
    }
    expect(
      fleetSnapshotSchema.safeParse({
        ...fleet,
        machines: [
          { ...fleet.machines[0], disks: [disk, { ...disk, volumeId: 'secondary' }] },
          ...fleet.machines.slice(1),
        ],
      }).success,
    ).toBe(false)
    fleet.machines[0]!.disks.push(disk)
    expect(fleetSnapshotSchema.safeParse(fleet).success).toBe(false)
    const lane = fakeEstimate().inputs.lanes[0]!
    lane.resources.disk[0]!.steadyBytes = structuredClone(lane.resources.disk[0]!.peakBytes)
    lane.resources.disk[0]!.steadyBytes.value!++
    lane.resources.disk[0]!.steadyBytes.uncertainty = { kind: 'unknown' }
    expect(estimateLaneSchema.safeParse(lane).success).toBe(false)
    expect(
      estimateLaneSchema.safeParse({ ...lane, resources: { ...lane.resources, disk: [] } }).success,
    ).toBe(false)
    expect(
      fleetSnapshotSchema.safeParse({
        ...fakeFleet(),
        machines: [{ ...fakeFleet().machines[0], disks: [] }, ...fakeFleet().machines.slice(1)],
      }).success,
    ).toBe(false)
  })

  it('distinguishes assumed, observed and unavailable resource quantities', () => {
    const lane = fakeEstimate().inputs.lanes[0]!
    const assumed = estimateLaneSchema.parse(lane)
    lane.resources.accountRequestsPerHour = {
      status: 'known',
      value: 1,
      basis: 'history',
      samples: 4,
      uncertainty: { kind: 'interval', lower: 0.5, upper: 2 },
    }
    const observed = estimateLaneSchema.parse(lane)
    expect(observed.resources.accountRequestsPerHour.value).toBe(
      assumed.resources.accountRequestsPerHour.value,
    )
    expect(observed.resources.accountRequestsPerHour).not.toEqual(
      assumed.resources.accountRequestsPerHour,
    )
    lane.resources.accountRequestsPerHour = {
      status: 'unknown',
      value: null,
      basis: 'unknown',
      samples: 0,
      uncertainty: { kind: 'unknown' },
    }
    expect(estimateLaneSchema.parse(lane).resources.accountRequestsPerHour.value).toBeNull()
  })

  it('requires resource provenance and honest unknown status', () => {
    const lane = fakeEstimate().inputs.lanes[0]!
    const resource = lane.resources.accountRequestsPerHour
    for (const change of [
      { basis: undefined },
      { status: undefined },
      { basis: 'history', samples: 0 },
      { basis: 'assumption', samples: 1 },
      { status: 'unknown' },
      {
        status: 'unknown',
        value: 1,
        basis: 'unknown',
        samples: 0,
        uncertainty: { kind: 'unknown' },
      },
      { value: null },
      { uncertainty: { kind: 'interval', lower: 2, upper: 1 } },
      { uncertainty: { kind: 'interval', lower: 2, upper: 3 } },
    ]) {
      expect(
        estimateLaneSchema.safeParse({
          ...lane,
          resources: { ...lane.resources, accountRequestsPerHour: { ...resource, ...change } },
        }).success,
      ).toBe(false)
    }
    expect(
      estimateLaneSchema.safeParse({
        ...lane,
        resources: { ...lane.resources, accountRequestsPerHour: 1 },
      }).success,
    ).toBe(false)
  })

  it('counts rounds per lane and retains strikes per module family and class', () => {
    const lane = fakeEstimate().inputs.lanes[0]!
    lane.review = {
      status: 'known',
      rounds: 2,
      modules: [
        { familyId: 'core', strikes: 1, classes: [{ class: 'validationSecurity', strikes: 1 }] },
        { familyId: 'ui', strikes: 1, classes: [{ class: 'docs', strikes: 1 }] },
      ],
      redesigns: [],
    }
    const separate = estimateLaneSchema.parse(lane).review
    lane.review = {
      status: 'known',
      rounds: 2,
      modules: [
        { familyId: 'core', strikes: 2, classes: [{ class: 'concurrencyLifecycle', strikes: 2 }] },
      ],
      redesigns: [{ moduleFamilyId: 'core', afterRound: 2, outcome: 'caught' }],
    }
    expect(estimateLaneSchema.parse(lane).review).not.toEqual(separate)
    const record = fakeHistoryRecord()
    expect(historyRecordSchema.parse({ ...record, review: lane.review }).review).toEqual(
      lane.review,
    )
    expect(historyRecordSchema.parse({ ...record, review: { status: 'unknown' } }).review).toEqual({
      status: 'unknown',
    })
  })

  it('rejects contradictory review aggregation and orphan redesign events', () => {
    const lane = fakeEstimate().inputs.lanes[0]!
    const module = { familyId: 'core', strikes: 2, classes: [{ class: 'docs', strikes: 2 }] }
    const review = { status: 'known', rounds: 2, modules: [module], redesigns: [] }
    for (const change of [
      { rounds: 1 },
      { modules: [module, module] },
      { modules: [{ ...module, classes: [module.classes[0], module.classes[0]] }] },
      { modules: [{ ...module, classes: [{ class: 'docs', strikes: 3 }] }] },
      { redesigns: [{ moduleFamilyId: 'missing', afterRound: 2, outcome: 'remains' }] },
      { redesigns: [{ moduleFamilyId: 'core', afterRound: 3, outcome: 'impossible' }] },
      {
        redesigns: [
          { moduleFamilyId: 'core', afterRound: 2, outcome: 'caught' },
          { moduleFamilyId: 'core', afterRound: 2, outcome: 'caught' },
        ],
      },
    ])
      expect(
        estimateLaneSchema.safeParse({ ...lane, review: { ...review, ...change } }).success,
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
    result.disclosures = fakeDisclosures(result)
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
        disclosures: fakeDisclosures({
          ...result,
          setups: [{ ...result.setups[0], machines: [{ ...machine, price }] }],
        }),
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

  it('requires calibration for every lane kind and scheduled machine class', () => {
    const result = fakeEstimate()
    expect(estimateSectionSchema.safeParse({ ...result, calibration: [] }).success).toBe(false)
    result.calibration[0]!.machineClassId = 'macos-arm64-builder'
    expect(estimateSectionSchema.safeParse(result).success).toBe(false)
    result.calibration[0]!.machineClassId = 'linux-x64-builder'
    result.inputs.lanes.push({ ...result.inputs.lanes[0]!, id: 'B', kind: 'ui' })
    result.disclosures = fakeDisclosures(result)
    expect(estimateSectionSchema.safeParse(result).success).toBe(false)
  })

  it('requires a calibration disclosure for every number and finish prediction', () => {
    const result = fakeEstimate()
    expect(estimateSectionSchema.safeParse({ ...result, disclosures: [] }).success).toBe(false)
    for (const path of [
      '/p50',
      '/p90',
      '/runs',
      '/inputs/lanes/0/resources/accountRequestsPerHour/value',
      '/inputs/fleet/machines/0/disks/0/headroomBytes',
      '/calibration/0/redesignRisk',
      '/setups/0/machines/0/marginalP90Hours',
    ]) {
      expect(result.disclosures.some((disclosure) => disclosure.path === path)).toBe(true)
      expect(
        estimateSectionSchema.safeParse({
          ...result,
          disclosures: result.disclosures.filter((disclosure) => disclosure.path !== path),
        }).success,
      ).toBe(false)
    }
    const runs = result.disclosures.find((disclosure) => disclosure.path === '/runs')!
    for (const change of [
      { basis: undefined },
      { samples: undefined },
      { uncertainty: undefined },
      { basis: 'history', samples: 0 },
      { uncertainty: { kind: 'interval', lower: 0, upper: 1 } },
    ]) {
      expect(
        estimateSectionSchema.safeParse({
          ...result,
          disclosures: result.disclosures.map((disclosure) =>
            disclosure === runs ? { ...disclosure, ...change } : disclosure,
          ),
        }).success,
      ).toBe(false)
    }
    runs.basis = 'calibration'
    runs.samples = 20
    expect(estimateSectionSchema.safeParse(result).success).toBe(true)
    runs.basis = 'unknown'
    runs.samples = 0
    runs.uncertainty = { kind: 'unknown' }
    expect(estimateSectionSchema.safeParse(result).success).toBe(true)
    expect(
      estimateSectionSchema.safeParse({
        ...result,
        disclosures: result.disclosures.map((disclosure) =>
          disclosure === runs ? { ...disclosure, path: '/absent' } : disclosure,
        ),
      }).success,
    ).toBe(false)
    runs.uncertainty = { kind: 'interval', lower: 2000, upper: 2000 }
    expect(estimateSectionSchema.safeParse(result).success).toBe(false)
    runs.uncertainty = { kind: 'unknown' }
    const duplicate = [...result.disclosures.slice(1), result.disclosures[1]]
    expect(estimateSectionSchema.safeParse({ ...result, disclosures: duplicate }).success).toBe(
      false,
    )
  })

  it('validates calibration identities and dated uncertainty bands', () => {
    const result = fakeEstimate()
    result.calibration.push(result.calibration[0]!)
    result.disclosures = fakeDisclosures(result)
    expect(estimateSectionSchema.safeParse(result).success).toBe(false)
    result.calibration.pop()
    result.disclosures = fakeDisclosures(result)
    const prediction = result.disclosures.find((disclosure) => disclosure.path === '/p50')!
    for (const uncertainty of [
      { kind: 'time', earliest: result.p90, latest: result.p50 },
      { kind: 'time', earliest: result.p90, latest: result.p90 },
      { kind: 'interval', lower: 0, upper: 1 },
    ])
      expect(
        estimateSectionSchema.safeParse({
          ...result,
          disclosures: result.disclosures.map((disclosure) =>
            disclosure === prediction ? { ...disclosure, uncertainty } : disclosure,
          ),
        }).success,
      ).toBe(false)
    expect(
      estimateSectionSchema.safeParse({
        ...result,
        inputs: { ...result.inputs, lanes: [] },
        schedule: [],
        criticalPath: [],
        calibration: [],
        disclosures: [],
      }).success,
    ).toBe(true)
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
