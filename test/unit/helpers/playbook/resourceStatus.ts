// A schema-parsed M107 governor reading at this level: no sample, no
// queue, no override. Shared so the holder and admission suites cannot
// drift apart.
import {
  resourceStatusSchema,
  type ResourceLevel,
  type ResourceStatus,
} from '../../../../src/shared/resources'

export function resourceStatus(level: ResourceLevel): ResourceStatus {
  return resourceStatusSchema.parse({
    level,
    sample: null,
    settings: {},
    queued: [],
    overrideUntilMs: null,
  })
}
