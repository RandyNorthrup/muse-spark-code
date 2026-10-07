import type { ResourceLease } from '../../core/resources/launch'
import type { ResourcePermit } from '../../core/resources/queue'
import type { GovernedTeamSlot } from '../../core/team/scheduler/slots'

/** C1/T attach the reserved permit to their registry; no second admission or sampler. */
export interface TeamProcessRegistryPort {
  attach(permit: ResourcePermit, onRetired: () => void): ResourceLease
}

/** M96 K calls before durable launch intent/spawn, then registers through this lease. */
export function prepareTeamProcess(
  slot: GovernedTeamSlot,
  registry: TeamProcessRegistryPort,
): ResourceLease {
  try {
    return registry.attach(slot.permit, () => {
      slot.release()
    })
  } catch (error) {
    // Nothing has spawned, so a failed binding cannot leave an occupied slot.
    slot.release()
    throw error
  }
}
