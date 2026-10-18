// Constructed estimate sections for the E-series projection tests.
//
// These are unit vectors, not recorded engine output: the values are
// arbitrary labels (like row keys or registry names elsewhere); every
// assertion made from them is structural (ordering, capping,
// language-independence, scrub-restore). The lane mirrors the committed
// dags.json chain vector's shape (ids, dependencies, hours). Nothing here
// claims to be a forecast.

import {
  disclosureTargets,
  estimateLaneSchema,
  estimateSectionSchema,
  fleetSnapshotSchema,
  type EstimateSection,
  type FleetSnapshot,
} from '../../../../src/shared/estimate'
import { ESTIMATE_RUNS } from '../../../../src/shared/constants'
import dags from '../../../fixtures/estimator/dags.json'
import { fleetMachine } from '../estimatorKindScheduleFixtures'

export const ESTIMATOR_AS_OF = '2026-10-06T12:00:00.000Z'

function vectorFleet(): FleetSnapshot {
  return fleetSnapshotSchema.parse({
    asOf: ESTIMATOR_AS_OF,
    machines: [fleetMachine('vector-linux', 'linux-x64-vector', 1)],
    roles: [],
    accounts: [],
    slots: [],
    ci: [],
  })
}

function vectorDisclosures(section: unknown): EstimateSection['disclosures'] {
  // Exactly the engine's own target set (numbers and p50/p90 dates), all
  // unknown-uncertainty: the schema's consistency check passes by
  // construction, and E23's multi-segment pointers come along.
  const disclosures: EstimateSection['disclosures'] = Array.from(
    disclosureTargets(section).keys(),
    (path) => ({
      path,
      basis: 'assumption',
      samples: 0,
      uncertainty: { kind: 'unknown' },
    }),
  )
  return disclosures
}

export function sectionVector(): EstimateSection {
  const lane = estimateLaneSchema.parse(dags[0]?.lanes[0])
  const section = {
    kind: 'estimate',
    schemaVersion: 1,
    asOf: ESTIMATOR_AS_OF,
    p50: '2026-10-06T13:00:00.000Z',
    p90: '2026-10-06T14:00:00.000Z',
    seed: 'vector-seed',
    runs: ESTIMATE_RUNS,
    schedule: [
      {
        laneId: lane.id,
        machineId: 'vector-linux',
        slotIds: ['vector-linux-1'],
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
            classId: 'linux-x64-vector',
            count: 1,
            slots: 1,
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
      fleet: vectorFleet(),
      history: [],
    },
    calibration: [
      {
        kind: 'core',
        machineClassId: 'linux-x64-vector',
        samples: 0,
        basis: 'uncalibratedPrior',
        mu: 0,
        sigma: 0.5,
        reviewRoundRate: 0.2,
        redesignRisk: 0.1,
      },
      {
        kind: 'review',
        machineClassId: 'linux-x64-vector',
        samples: 0,
        basis: 'uncalibratedPrior',
        mu: 0,
        sigma: 0.5,
        reviewRoundRate: 0.2,
        redesignRisk: 0.1,
      },
    ],
  }
  return estimateSectionSchema.parse({ ...section, disclosures: vectorDisclosures(section) })
}
