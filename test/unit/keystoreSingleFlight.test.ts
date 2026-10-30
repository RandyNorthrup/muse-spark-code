// The reconciled keystore one-owner wrapper (docs/certification/rlm109.md,
// source 07 declined verbatim) over the real OS credential store: the real
// multipart keyring store under the real single-flight wrapper, on a
// throwaway service. Nothing is replaced. Each case fails when a person
// would be hurt: a stale key served after it changed, a transient store
// failure remembered for the process, a rejected key kept after the
// provider refused it, or one OS read per caller instead of one per entry.
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  keyringSecretStore,
  noteKeyRejectedStatus,
  ownedKeyringSecretStore,
  StoreUnavailableError,
} from '../../src/runtime/keyStore'
import { createSingleFlightSecretStore } from '../../src/host/auth/credentialStore'
import { HTTP_STATUS, KEYRING_SERVICE } from '../../src/shared/constants'
import { deleteAllServiceEntries } from './helpers/keyringCleanup'

// The OS backends on macOS/Linux require native qualification on those rigs
// (as in keyringParts.test.ts), so the suite runs on Windows in hosted CI;
// hosts.yml qualifies the store itself on all three OSes (keystore.sh).
describe.runIf(process.platform === 'win32')('keystore single-flight owner', () => {
  it('remembers a value and an absence until forgotten, then reads the store once more', async () => {
    const { AsyncEntry, findCredentialsAsync } = await import('@napi-rs/keyring')
    const scope = randomUUID()
    const service = `${KEYRING_SERVICE}.test.${scope}`
    const account = 'single-flight'
    const owned = ownedKeyringSecretStore((_, name) => new AsyncEntry(service, name), {
      lockScope: scope,
    })
    try {
      // An absence is remembered: an entry created behind the wrapper is
      // not seen until the entry is forgotten.
      expect(await owned.get(account)).toBeUndefined()
      await new AsyncEntry(service, account).setPassword('behind')
      expect(await owned.get(account)).toBeUndefined()
      owned.forget(account)
      expect(await owned.get(account)).toBe('behind')
      // A value is remembered the same way.
      await new AsyncEntry(service, account).setPassword('changed')
      expect(await owned.get(account)).toBe('behind')
      owned.forget(account)
      expect(await owned.get(account)).toBe('changed')
      // This process's own writes are the remembered value at once.
      await owned.store(account, 'written')
      expect(await owned.get(account)).toBe('written')
      await owned.delete(account)
      expect(await owned.get(account)).toBeUndefined()
      expect(await findCredentialsAsync(service)).toEqual([])
    } finally {
      await deleteAllServiceEntries(service)
    }
  })

  it('concurrent reads share one OS read; a failed read is never remembered', async () => {
    const { AsyncEntry, findCredentialsAsync } = await import('@napi-rs/keyring')
    const scope = randomUUID()
    const service = `${KEYRING_SERVICE}.test.${scope}`
    const account = 'single-flight-concurrent'
    let opens = 0
    const raw = keyringSecretStore(
      (_, name) => {
        opens += 1
        return new AsyncEntry(service, name)
      },
      { lockScope: scope },
    )
    const owned = createSingleFlightSecretStore(raw)
    try {
      await owned.store(account, 'v'.repeat(2500))
      owned.forget(account)
      const beforeOne = opens
      expect(await owned.get(account)).toBe('v'.repeat(2500))
      const oneReadOpens = opens - beforeOne
      owned.forget(account)
      const beforeMany = opens
      const values = await Promise.all([
        owned.get(account),
        owned.get(account),
        owned.get(account),
        owned.get(account),
        owned.get(account),
      ])
      expect(values).toEqual(Array.from({ length: 5 }, () => 'v'.repeat(2500)))
      expect(opens - beforeMany).toBe(oneReadOpens)
      // Corrupt one part behind the wrapper: the read fails with the
      // store's own error, and once the part is repaired the next call
      // reads the store again without any forget.
      const entries = await findCredentialsAsync(service)
      const part = entries.find((entry) => entry.account.startsWith(`${account}#`))
      if (part === undefined) throw new Error('long value has no native parts')
      const original = await new AsyncEntry(service, part.account).getPassword()
      if (original === null) throw new Error('part has no value')
      await new AsyncEntry(service, part.account).setPassword('corrupted')
      owned.forget(account)
      await expect(owned.get(account)).rejects.toBeInstanceOf(StoreUnavailableError)
      await new AsyncEntry(service, part.account).setPassword(original)
      expect(await owned.get(account)).toBe('v'.repeat(2500))
      await owned.delete(account)
      expect(await findCredentialsAsync(service)).toEqual([])
    } finally {
      await deleteAllServiceEntries(service)
    }
  })

  it('a provider rejection forgets exactly that entry; other failures keep it', async () => {
    const { AsyncEntry, findCredentialsAsync } = await import('@napi-rs/keyring')
    const scope = randomUUID()
    const service = `${KEYRING_SERVICE}.test.${scope}`
    const account = 'single-flight-rejected'
    const owned = ownedKeyringSecretStore((_, name) => new AsyncEntry(service, name), {
      lockScope: scope,
    })
    try {
      await owned.store(account, 'old-key')
      await new AsyncEntry(service, account).setPassword('new-key')
      // A server failure is not a rejection: the remembered key stays.
      noteKeyRejectedStatus(owned, account, HTTP_STATUS.internalServerError)
      expect(await owned.get(account)).toBe('old-key')
      // No status at all (the request never got an answer) keeps it too.
      noteKeyRejectedStatus(owned, account, undefined)
      expect(await owned.get(account)).toBe('old-key')
      // A 401 refused the remembered key: the next use reads the store.
      noteKeyRejectedStatus(owned, account, HTTP_STATUS.unauthorized)
      expect(await owned.get(account)).toBe('new-key')
      await owned.delete(account)
      expect(await findCredentialsAsync(service)).toEqual([])
    } finally {
      await deleteAllServiceEntries(service)
    }
  })
})
