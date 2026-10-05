// Removal with Undo (M95 lane K, PLAN.md D74, M95 acceptance 15): a
// removal waits ten seconds behind Undo before its secret is deleted (or
// completes at the next start if the window closes first). Undo restores
// the removed provider with its key, since the secret is kept until the
// window passes.

import { PROVIDER_UNDO_WINDOW_MS } from '../../shared/constants'
import { deleteProviderCredential, type RecordStore } from './credentialRecords'
import type { ProviderEntry, ProvidersStore } from './providerPorts'

/** A removal waiting out its Undo window. */
export interface PendingRemoval {
  readonly entry: ProviderEntry
  readonly removedAt: number
}

/** The pending removals' persistence (VS Code global state in production). */
export interface RemovalStore {
  load(): Promise<readonly PendingRemoval[]>
  save(pending: readonly PendingRemoval[]): Promise<void>
}

/** The clock, injected so tests own the ten seconds. */
export interface RemovalClock {
  now(): number
  schedule(ms: number, run: () => void): { cancel(): void }
}

export interface ProviderRemovalDeps {
  readonly providers: ProvidersStore
  readonly secrets: RecordStore
  readonly pending: RemovalStore
  readonly clock: RemovalClock
  readonly undoWindowMs?: number | undefined
}

export interface ProviderRemoval {
  /**
   * Removes the provider from the file and schedules its secret's
   * deletion. The removed entry, for the Undo bar; undefined when no such
   * provider is configured.
   */
  remove(id: string): Promise<ProviderEntry | undefined>
  /** Restores a removed provider with its key; false when its window passed. */
  undo(id: string): Promise<boolean>
  /**
   * Finishes removals a closed window left behind: deletes their secrets.
   * Throws naming the ids whose secret survived, after attempting them all.
   */
  completePending(): Promise<void>
}

export function createProviderRemoval(deps: ProviderRemovalDeps): ProviderRemoval {
  const undoWindowMs = deps.undoWindowMs ?? PROVIDER_UNDO_WINDOW_MS
  const timers = new Map<string, { cancel(): void }>()

  const dropPending = async (id: string): Promise<readonly PendingRemoval[]> => {
    const pending = await deps.pending.load()
    const kept = pending.filter((removal) => removal.entry.id !== id)
    await deps.pending.save(kept)
    return kept
  }

  // The window's end deletes the secret. A failure keeps the pending, so
  // the next start's `completePending` retries it; it never rejects into
  // the timer.
  const finish = async (id: string): Promise<void> => {
    timers.get(id)?.cancel()
    timers.delete(id)
    try {
      await deleteProviderCredential(deps.secrets, id)
      await dropPending(id)
    } catch {
      return
    }
  }

  return {
    remove: async (id) => {
      const entry = await deps.providers.remove(id)
      if (entry === undefined) {
        return
      }
      timers.get(id)?.cancel()
      timers.set(
        id,
        deps.clock.schedule(undoWindowMs, () => void finish(id)),
      )
      const pending = await deps.pending.load()
      await deps.pending.save([
        ...pending.filter((removal) => removal.entry.id !== id),
        { entry, removedAt: deps.clock.now() },
      ])
      return entry
    },
    undo: async (id) => {
      const pending = await deps.pending.load()
      const removal = pending.find((candidate) => candidate.entry.id === id)
      if (removal === undefined || deps.clock.now() - removal.removedAt > undoWindowMs) {
        return false
      }
      timers.get(id)?.cancel()
      timers.delete(id)
      await deps.providers.restore(removal.entry)
      await dropPending(id)
      return true
    },
    completePending: async () => {
      const failed: string[] = []
      const pending = await deps.pending.load()
      for (const removal of pending) {
        try {
          await deleteProviderCredential(deps.secrets, removal.entry.id)
        } catch {
          failed.push(removal.entry.id)
        }
      }
      const remaining = await deps.pending.load()
      const kept = remaining.filter((removal) => failed.includes(removal.entry.id))
      await deps.pending.save(kept)
      if (failed.length > 0) {
        throw new Error(`The secrets of ${failed.join(', ')} could not be deleted`)
      }
    },
  }
}
