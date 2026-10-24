// Sync cells for the latest async readings (M116, PLAN.md D218/D219).
// The playbook's sync ports (the board, the check admission) cannot await;
// the holder serves the latest reading instead. Unknown is never a value:
// a failed read clears to unknown rather than keeping a stale one, and
// the failure rides home as the result's cause for the caller.
import type { PlaybookCheckAdmission } from './policy'
import type { ResourceStatus } from '../../../shared/resources'

export type ReadingRefresh = { readonly ok: true } | { readonly ok: false; readonly cause: unknown }

export interface ReadingHolder<T> {
  /** The latest reading; undefined reads as unknown, never as a value. */
  get(): T | undefined
  set(value: T | undefined): void
  /**
  Refresh from a sync or async read: the holder takes the read value, or
  unknown when the read fails or finds nothing.
  */
  refresh(read: () => T | Promise<T | undefined> | undefined): Promise<ReadingRefresh>
}

export function createReadingHolder<T>(): ReadingHolder<T> {
  let current: T | undefined
  return {
    get: () => current,
    set: (value) => {
      current = value
    },
    refresh: async (read) => {
      try {
        current = await read()
        return { ok: true }
      } catch (error: unknown) {
        current = undefined
        return { ok: false, cause: error }
      }
    },
  }
}

/**
The hosts' check admission (D219): the latest M107 resource-governor
reading pauses local checks only at the paused level, where the governor
itself pauses new work. Throttled or relocating machines still run checks;
worker and CI targets admit (their own side governs them); unknown never
pauses work. The panel's fail-closed port stays the panel's.
*/
export function createCapacityAdmission(
  holder: Pick<ReadingHolder<ResourceStatus>, 'get'>,
): PlaybookCheckAdmission {
  return {
    admit: (_check, target) => target.kind !== 'local' || holder.get()?.level !== 'pause',
  }
}
