import dags from '../../../fixtures/estimator/dags.json'
import {
  estimateLaneSchema,
  estimateSectionSchema,
  type EstimateLane,
  type EstimateSection,
  type HistoryRecord,
} from '../../../../src/shared/estimate'
import type { EstimateGoalSnapshot } from '../../../../src/core/estimator/goal'
import { ESTIMATE_RUNS } from '../../../../src/shared/constants'
import { ESTIMATOR_AS_OF, fakeFleet } from './fakes'

/** Fictional exact values and a P50–P90 band, explicitly assumption-based. */
export function fakeDisclosures(value: unknown, pointer = ''): EstimateSection['disclosures'] {
  if (typeof value === 'number')
    return [
      {
        path: pointer,
        basis: 'assumption',
        samples: 0,
        uncertainty: { kind: 'interval', lower: value, upper: value },
      },
    ]
  if (typeof value === 'string' && /\/(?:p50|p90)$/.test(pointer))
    return [
      {
        path: pointer,
        basis: 'assumption',
        samples: 0,
        uncertainty: {
          kind: 'time',
          earliest: '2026-10-06T13:00:00.000Z',
          latest: '2026-10-06T14:00:00.000Z',
        },
      },
    ]
  return value === null || typeof value !== 'object'
    ? []
    : Object.entries(value).flatMap(([key, child]) =>
        pointer === '' && key === 'disclosures'
          ? []
          : fakeDisclosures(child, `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`),
      )
}

/** The `chain` dag with M117 lane ids, contracts first: one copy for every suite. */
export function chainLanes(): EstimateLane[] {
  const chain = dags.find((fixture) => fixture.name === 'chain')
  if (chain === undefined) throw new Error('missing chain fixture')
  return chain.lanes.map((input, index) =>
    estimateLaneSchema.parse({
      ...input,
      id: `M117:${input.id}`,
      kind: index === 0 ? 'contracts' : input.kind,
      dependencies: input.dependencies.map((id) => `M117:${id}`),
    }),
  )
}

/** The chain lanes as a goal snapshot for the M117 milestone. */
export function chainSnapshot(asOf = ESTIMATOR_AS_OF): EstimateGoalSnapshot {
  const lanes = chainLanes().map((lane) => ({ lane }))
  return {
    asOf,
    lanes,
    milestones: [{ id: 'M117', laneIds: lanes.map(({ lane }) => lane.id) }],
    pullRequests: [],
    issues: [],
    releases: [],
    rigs: [],
  }
}

export function fakeHistoryRecord(laneId = 'M117:core'): HistoryRecord {
  return {
    laneId,
    kind: 'core',
    machineClassId: 'linux-x64-builder',
    estimatedHours: 2,
    actualHours: 3,
    review: {
      status: 'known',
      rounds: 1,
      modules: [
        { familyId: 'core', strikes: 1, classes: [{ class: 'validationSecurity', strikes: 1 }] },
      ],
      redesigns: [],
    },
    ciHours: 0.1,
    startedAt: '2026-10-05T10:00:00.000Z',
    finishedAt: '2026-10-05T13:00:00.000Z',
    durationBasis: 'agentTime',
    source: 'board',
  }
}

export function fakeEstimate(): EstimateSection {
  const lane = estimateLaneSchema.parse(dags[0]?.lanes[0])
  const section = {
    kind: 'estimate',
    schemaVersion: 1,
    asOf: ESTIMATOR_AS_OF,
    p50: '2026-10-06T13:00:00.000Z',
    p90: '2026-10-06T14:00:00.000Z',
    seed: 'fixture-seed',
    runs: ESTIMATE_RUNS,
    schedule: [
      {
        laneId: lane.id,
        machineId: 'linux',
        slotIds: ['linux-1'],
        accountIds: ['account-1'],
        start: ESTIMATOR_AS_OF,
        end: '2026-10-06T13:00:00.000Z',
        slackHours: 0,
        critical: true,
      },
    ],
    criticalPath: [lane.id],
    limitingResource: { kind: 'criticalPath', hoursSavedIfUnbounded: 0, moreAgentsHelp: false },
    setups: [
      {
        kind: 'current',
        machines: [
          {
            classId: 'linux-x64-builder',
            count: 1,
            slots: 2,
            accounts: 1,
            marginalP50Hours: 0,
            marginalP90Hours: 0,
          },
        ],
        p50: '2026-10-06T13:00:00.000Z',
        p90: '2026-10-06T14:00:00.000Z',
        meetsDeadline: false,
        provisioning: 'existing',
      },
    ],
    inputs: {
      request: {
        goal: { kind: 'milestone', milestoneId: 'M117' },
        asOf: ESTIMATOR_AS_OF,
        fleet: 'current',
        optimize: 'cost',
      },
      lanes: [lane],
      fleet: fakeFleet(),
      history: [],
    },
    calibration: [
      {
        kind: 'core',
        machineClassId: 'linux-x64-builder',
        samples: 0,
        basis: 'uncalibratedPrior',
        mu: 0,
        sigma: 0.5,
        reviewRoundRate: 0.2,
        redesignRisk: 0.1,
      },
    ],
  }
  return estimateSectionSchema.parse({ ...section, disclosures: fakeDisclosures(section) })
}
