import dags from '../../fixtures/estimator/dags.json'
import { estimateLaneSchema, type EstimateLane } from '../../../src/shared/estimate'

export function goalLane(id: string, changes: Partial<EstimateLane> = {}): EstimateLane {
  return estimateLaneSchema.parse({ ...dags[0]?.lanes[0], id, ...changes })
}
