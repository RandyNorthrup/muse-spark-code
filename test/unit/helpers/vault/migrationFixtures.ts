// Shared seams for the key-store migration tests (D89.14 lane M): a
// Map-backed SecretStorage and a capturing logger. Both migration suites
// and the rules-file bundle suite build the same shapes; one definition
// keeps the clone gate quiet without changing any assertion.
import type { SecretStore } from '../../../../src/host/auth/credentialStore'
import type { Logger } from '../../../../src/host/logger'

export function mapSecrets(initial: Readonly<Record<string, string>> = {}): {
  store: SecretStore
  saved: Map<string, string>
} {
  const saved = new Map(Object.entries(initial))
  return {
    saved,
    store: {
      get: (key) => Promise.resolve(saved.get(key)),
      store: (key, value) => {
        saved.set(key, value)
        return Promise.resolve()
      },
      delete: (key) => {
        saved.delete(key)
        return Promise.resolve()
      },
    },
  }
}

export function capturingLog(): { log: Logger; logged: string[] } {
  const logged: string[] = []
  return {
    logged,
    log: {
      trace: (message) => {
        logged.push(`trace:${message}`)
      },
      info: (message) => {
        logged.push(`info:${message}`)
      },
      warn: (message) => {
        logged.push(`warn:${message}`)
      },
      error: (message) => {
        logged.push(`error:${message}`)
      },
    },
  }
}
