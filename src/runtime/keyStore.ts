// The Model API key outside VS Code (PLAN.md D61): the operating system's
// credential store, reached in this process. Windows Credential Manager,
// the macOS login Keychain, and on Linux the Secret Service only (the
// kernel keyring would forget the key at reboot, so it is never used).
// The entry is opened per call through an injected factory, so the tests
// run against a map and the process against `@napi-rs/keyring`. A missing
// entry reads as null from the native binding, whatever its typings say
// (found against GNOME Keyring, docs/certification/m63.md), and as
// undefined everywhere past this file.

import type { SecretStore } from '../host/auth/credentialStore'
import { KEYRING_SERVICE, UI_TEXT } from '../shared/constants'

/** The three calls the agent makes on one credential (`@napi-rs/keyring`'s `AsyncEntry`). */
export interface KeyringEntry {
  getPassword(): Promise<string | null | undefined>
  setPassword(password: string): Promise<void>
  deletePassword(): Promise<boolean>
}

/** Opens the entry for a service and account; throws when the store cannot be used. */
export type KeyringEntryFactory = (service: string, account: string) => KeyringEntry

/** Native failures may contain account or credential text; retain neither. */
export class StoreUnavailableError extends Error {
  public constructor() {
    super('store-unavailable')
    this.name = 'StoreUnavailableError'
  }
}

async function storeOperation<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch {
    // Includes Windows logon-session failures, locked/denied Keychains and
    // absent Linux Secret Service. Nothing supplied by the binding escapes.
    throw new StoreUnavailableError()
  }
}

/** The credential store as the key's `SecretStore`, each call on a freshly opened entry. */
export function keyringSecretStore(openEntry: KeyringEntryFactory): SecretStore {
  return {
    get: async (key) =>
      await storeOperation(
        async () => (await openEntry(KEYRING_SERVICE, key).getPassword()) ?? undefined,
      ),
    store: async (key, value) => {
      await storeOperation(() => openEntry(KEYRING_SERVICE, key).setPassword(value))
    },
    delete: async (key) => {
      await storeOperation(() => openEntry(KEYRING_SERVICE, key).deletePassword())
    },
  }
}

/** Where the key lives on this platform, as the user knows it. */
export function credentialStoreName(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'win32': {
      return UI_TEXT.acpStoreNames.windows
    }
    case 'darwin': {
      return UI_TEXT.acpStoreNames.macos
    }
    default: {
      return UI_TEXT.acpStoreNames.linux
    }
  }
}
