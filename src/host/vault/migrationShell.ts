// The extension's SecretStorage as the vault migration sees it: reads always
// reach SecretStorage (a person who never enables the vault keeps working
// exactly as now, and activation never reads the vault or starts a broker);
// writes mirror into the vault once the migration binds and only while its
// slot is active. This module carries no vault import, so activation keeps
// its bundle shape; the lazy migration controller binds later.
import type { SecretStore } from '../auth/credentialStore'

/**
 * The one serialization all migration work shares, across every controller
 * the panel binds: one promise queue, never nested (an op that runs inside
 * it never starts another). A SecretStorage write and a migration engine op
 * can never overlap, so a save that lands mid-migration is seen whole by
 * the engine's next check instead of being overwritten by it. Module-level
 * because controllers come and go with the panel binding while the shell
 * lives with the window.
 */
/**
 * One FIFO lane for migration work. The tail promise always resolves, so a
 * failed op never blocks the lane; an op never starts another (nesting
 * would wait on itself).
 */
class MigrationLock {
  private tail: Promise<void> = Promise.resolve()
  async run<T>(work: () => Promise<T>): Promise<T> {
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
      return await work()
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
  /** Drop a removed key's migrated slot; throws when it cannot. */
  mirrorDelete(key: string): Promise<void>
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
        // The SecretStorage write holds the shared lock, so it can never
        // land in the middle of a migration engine op; the mirror runs
        // after, as its own op, and a mirror the engine refuses (a newer
        // save already landed) heals on a later pass. Never let either
        // break the person's save.
        await withMigrationLock(() => Promise.resolve(secrets.store(key, value)))
        try {
          await mirror?.mirrorWrite(key, value)
        } catch {
          /* Healed at the next unlock; the save itself succeeded. */
        }
      },
      async delete(key) {
        await withMigrationLock(() => Promise.resolve(secrets.delete(key)))
        try {
          await mirror?.mirrorDelete(key)
        } catch {
          /* Healed at the next unlock; the removal itself succeeded. */
        }
      },
    },
    bind(candidate) {
      mirror = candidate
    },
  }
}
