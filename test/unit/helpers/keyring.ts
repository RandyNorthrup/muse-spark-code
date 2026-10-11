import type { KeyringEntryFactory } from '../../../src/runtime/keyStore'

/** An in-memory keyring entry factory for runtime service rigs. */
export function memoryKeyring(): {
  openEntry: KeyringEntryFactory
  values: Map<string, string>
} {
  const values = new Map<string, string>()
  const openEntry: KeyringEntryFactory = (_service, name) => ({
    getPassword: () => Promise.resolve(values.get(name)),
    setPassword: (value: string) => {
      values.set(name, value)
      return Promise.resolve()
    },
    deletePassword: () => Promise.resolve(values.delete(name)),
  })
  return { openEntry, values }
}
