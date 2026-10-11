import type { KeyringEntryFactory } from '../../../src/runtime/keyStore'

/** An in-memory keyring entry factory for runtime service rigs. */
export function memoryKeyring(isServiceScoped = false): {
  openEntry: KeyringEntryFactory
  values: Map<string, string>
} {
  const values = new Map<string, string>()
  const key = (service: string, name: string) => (isServiceScoped ? `${service}/${name}` : name)
  const openEntry: KeyringEntryFactory = (service, name) => ({
    getPassword: () => Promise.resolve(values.get(key(service, name))),
    setPassword: (value: string) => {
      values.set(key(service, name), value)
      return Promise.resolve()
    },
    deletePassword: () => Promise.resolve(values.delete(key(service, name))),
  })
  return { openEntry, values }
}
