import dags from '../../fixtures/estimator/dags.json'
import { estimateLaneSchema, type EstimateLane } from '../../../src/shared/estimate'
import { type EstimateGoalSnapshot } from '../../../src/core/estimator/goal'
import { ESTIMATOR_AS_OF } from './estimator/fakes'

export function goalLane(id: string, changes: Partial<EstimateLane> = {}): EstimateLane {
  return estimateLaneSchema.parse({ ...dags[0]?.lanes[0], id, ...changes })
}

export function goalSnapshot(): EstimateGoalSnapshot {
  return {
    asOf: ESTIMATOR_AS_OF,
    lanes: [
      { lane: goalLane('M112:0') },
      { lane: goalLane('M112:Q', { dependencies: ['M112:0'] }), rigId: 'macmini' },
      { lane: goalLane('M112:U', { dependencies: ['M112:Q'] }) },
      { lane: goalLane('M113:S', { dependencies: ['M112:0'] }) },
    ],
    milestones: [
      { id: 'M112', laneIds: ['M112:0', 'M112:Q', 'M112:U'] },
      { id: 'M113', laneIds: ['M113:S'] },
      { id: 'M110a0', laneIds: [] },
    ],
    pullRequests: [
      { number: 12, state: 'open', laneIds: ['M112:Q'] },
      { number: 13, state: 'closed', laneIds: ['M113:S'] },
    ],
    issues: [
      { number: 2, labels: ['bug', 'good first issue'], laneIds: ['M112:U'] },
      { number: 7, labels: ['bug'], laneIds: ['M113:S', 'M112:Q'] },
    ],
    releases: [
      { id: '0.16.0', milestoneIds: ['M112', 'M113'] },
      { id: 'empty', milestoneIds: [] },
    ],
    rigs: [
      {
        id: 'macmini',
        affinity: {
          os: ['macos'],
          architectures: ['arm64'],
          machineClassIds: [],
          gpuRequired: false,
        },
      },
    ],
  }
}
