import type { GovernedTeamSlots } from '../../core/team/scheduler/slots'
import type { ResourcePermit } from '../../core/resources/queue'

/** Heavy team checks use the same governor queue as workers, under the check kind. */
export function requestCheckSlot(
  slots: GovernedTeamSlots,
  priority: number,
  signal?: AbortSignal,
  parent?: ResourcePermit,
) {
  return slots.request({ kind: 'check', priority, ...(parent !== undefined && { parent }) }, signal)
}
