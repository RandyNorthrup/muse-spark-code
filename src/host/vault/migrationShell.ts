// The extension's SecretStorage as the vault migration sees it: reads always
// reach SecretStorage (a person who never enables the vault keeps working
// exactly as now, and activation never reads the vault or starts a broker);
// writes mirror into the vault once the migration binds and only while its
// slot is active. This module carries no vault import, so activation keeps
// its bundle shape; the lazy migration controller binds later.
import { AsyncLocalStorage } from 'node:async_hooks'
import type { SecretStore } from '../auth/credentialStore'

/**
 * The one serialization all migration work shares, across every controller
 * the panel binds: one promise queue, re-entered but never overlapped. A
 * save and a sign-out each hold the lane across both of their phases (the
 * SecretStorage commit and its vault mirror), so whichever arrives second
 * sees the first's committed result instead of landing between the other's
 * phases. Module-level because controllers come and go with the panel
 * binding while the shell lives with the window.
 */
/**
 * One FIFO lane for migration work. The tail promise always resolves, so a
 * failed op never blocks the lane. Work that starts inside the lane runs in
 * it instead of behind it: the mirror's engine ops re-enter the lane their
 * save or sign-out already holds, and queueing there would wait on the
 * holder itself.
 */
class MigrationLock {
  private tail: Promise<void> = Promise.resolve()
  /**
   * The async ancestry of the lane's current holder. Only work descended
   * from the holder re-enters the lane: the mirror's engine ops run inside
   * the save or sign-out that already holds it, and queueing there would
   * wait on the holder itself. An independent op that merely arrives while
   * the lane is busy has no such ancestry and still queues behind it, so a
   * save racing a sign-out can never slip between the other's phases.
   */
  private readonly holder = new AsyncLocalStorage<true>()
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.holder.getStore() === true) return await work()
    const previous = this.tail
    // Not `Promise.withResolvers`, which Node 20 (VS Code 1.99's host) lacks.
    let release: (() => void) | undefined
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- Node 20 (VS Code 1.99's host) lacks Promise.withResolvers (PLAN.md §8); the executor assigns the resolver synchronously, so release?.() in finally always releases the next owner.
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    this.tail = gate
    await previous
    try {
      return await this.holder.run(true, work)
    } finally {
      release?.()
    }
  }
}

const migrationLock = new MigrationLock()

/** Run work after every earlier migration op finished, without overlapping it. */
export function withMigrationLock<T>(work: () => Promise<T>): Promise<T> {
  return migrationLock.run(work)
}

/** The vault side the lazy controller binds; null while unbound. */
export interface MigrationMirror {
  /** Copy a written value into its migrated slot; throws when it cannot. */
  mirrorWrite(key: string, value: string): Promise<void>
  /**
   * Drop a removed key's migrated slot. Resolves true when the engine owned
   * the delete (both copies); false for a key it never took, whose
   * SecretStorage entry the shell still clears. Throws when it cannot: the
   * shell leaves SecretStorage as it is and the failure surfaces.
   */
  mirrorDelete(key: string): Promise<boolean>
}

/** Activation owns the shell; the lazy vault binding owns the mirror. */
export interface MigrationShell {
  /** The store every host credential path shares (reads always pass through). */
  readonly store: SecretStore
  /**
   * Bound when a vault binding builds; a newer binding replaces the older
   * one (the panel rebuilds its binding while its tab lives). A disposed
   * binding's mirror fails contained, back to plain SecretStorage.
   */
  bind(mirror: MigrationMirror): void
}

export function createMigrationShell(secrets: SecretStore): MigrationShell {
  let mirror: MigrationMirror | null = null
  return {
    store: {
      get: (key) => secrets.get(key),
      async store(key, value) {
        // One lane holding across the SecretStorage commit and its vault
        // mirror: a sign-out that arrives second sees this save's committed
        // result and removes both copies, and a save that arrives second
        // re-seeds after the sign-out instead of landing between its clear
        // and its engine delete and losing the newer key the old
        // removeLegacy way. A mirror the engine refuses still never breaks
        // the save; the next unlock heals it.
        await withMigrationLock(async () => {
          await secrets.store(key, value)
          try {
            await mirror?.mirrorWrite(key, value)
          } catch {
            /* Healed at the next unlock; the save itself succeeded. */
          }
        })
      },
      async delete(key) {
        // The mirror image of store: the engine delete and the SecretStorage
        // clear are one atomic op, so a save that arrives second re-seeds
        // after it instead of being wiped by its trailing remove, and no
        // stale in-flight mirror can recreate the key once this completes.
        // While a mirror is bound the engine goes first: it journals
        // `deleting` before it removes either copy, so a failure before
        // that journal write leaves SecretStorage untouched and surfaces
        // instead of resolving with the key unreadable and its vault copy
        // stranded (the next unlock only heals a journaled `deleting` row).
        // A key the migration never took deletes the plain way.
        await withMigrationLock(async () => {
          if (mirror !== null && (await mirror.mirrorDelete(key))) return
          await secrets.delete(key)
        })
      },
    },
    bind(candidate) {
      mirror = candidate
    },
  }
}
