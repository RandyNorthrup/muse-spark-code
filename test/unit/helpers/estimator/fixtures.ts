import dags from '../../../fixtures/estimator/dags.json'
import {
  estimateLaneSchema,
  estimateSectionSchema,
  type EstimateSection,
  type HistoryRecord,
} from '../../../../src/shared/estimate'
import { ESTIMATE_RUNS } from '../../../../src/shared/constants'
import { ESTIMATOR_AS_OF, fakeFleet } from './fakes'

export function fakeHistoryRecord(laneId = 'M117:core'): HistoryRecord {
  return {
    laneId,
    kind: 'core',
    machineClassId: 'linux-x64-builder',
    estimatedHours: 2,
    actualHours: 3,
    reviewRounds: 1,
    ciHours: 0.1,
    startedAt: '2026-10-05T10:00:00.000Z',
    finishedAt: '2026-10-05T13:00:00.000Z',
    durationBasis: 'agentTime',
    source: 'board',
  }
}

export function fakeEstimate(): EstimateSection {
  const lane = estimateLaneSchema.parse(dags[0]?.lanes[0])
  return estimateSectionSchema.parse({
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
  })
}
