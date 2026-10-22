// One live and one retired process reference both M96d coordinator
// suites share: the grant engine's adversarial schedules and the
// durable store's custody proofs register the same shape.
import type { CoordinatorReference } from '../../../src/core/team/coordinator/references'

export const reference: CoordinatorReference = {
  platform: 'linux',
  kind: 'pidfd',
  token: 'held-reference-A',
  boot: 'boot-A',
  start: '1000001',
  pid: 42,
  validated: true,
  exited: false,
}
export const retiredReference: CoordinatorReference = { ...reference, exited: true }
