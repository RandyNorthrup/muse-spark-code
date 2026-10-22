// An in-memory secret store for tests: entries start readable, writes land
// in the same map, and deletes remove.
import type { SecretStore } from '../../../src/host/auth/credentialStore'

export function mapSecrets(entries: Readonly<Record<string, string>>): SecretStore {
  return mapSecretsBacked(new Map(Object.entries(entries)))
}

/** An in-memory secret store over a caller-owned map, so tests can read back writes. */
export function mapSecretsBacked(backing: Map<string, string>): SecretStore {
  return {
    get: (key: string) => Promise.resolve(backing.get(key)),
    store: (key: string, value: string) => {
      backing.set(key, value)
      return Promise.resolve()
    },
    delete: (key: string) => {
      backing.delete(key)
      return Promise.resolve()
    },
  }
}
