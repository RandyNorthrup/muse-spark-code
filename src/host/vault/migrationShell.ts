// The extension's SecretStorage as the vault migration sees it: reads always
// reach SecretStorage (a person who never enables the vault keeps working
// exactly as now, and activation never reads the vault or starts a broker);
// writes mirror into the vault once the migration binds and only while its
// slot is active. This module carries no vault import, so activation keeps
// its bundle shape; the lazy migration controller binds later.
import type { SecretStore } from '../auth/credentialStore'

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
        await secrets.store(key, value)
        // The SecretStorage write already landed: a vault mirror that
        // cannot land leaves the stores diverged, and the next unlock
        // heals it from SecretStorage (the read source of truth). Never
        // let it break the person's save.
        try {
          await mirror?.mirrorWrite(key, value)
        } catch {
          /* Healed at the next unlock; the save itself succeeded. */
        }
      },
      async delete(key) {
        await secrets.delete(key)
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
