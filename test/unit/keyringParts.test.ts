// F78: the real multipart store and real native credential service. Every
// entry belongs to a separate random test service; no production enumeration.
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { keyringSecretStore, StoreUnavailableError } from '../../src/runtime/keyStore'
import { KEYRING_PARTS_TAG, KEYRING_SERVICE } from '../../src/shared/constants'

// The OS backends on macOS/Linux require native qualification on those rigs.
describe.runIf(process.platform === 'win32')('native multipart credentials', () => {
  it('round-trips, replaces and deletes short, long and tag-prefixed values without orphan parts', async () => {
    const { AsyncEntry, findCredentialsAsync } = await import('@napi-rs/keyring')
    const scope = randomUUID()
    const service = `${KEYRING_SERVICE}.test.${scope}`
    const account = 'parts'
    const store = keyringSecretStore((_, name) => new AsyncEntry(service, name), {
      lockScope: scope,
    })
    try {
      for (const value of [
        'short',
        'x'.repeat(3000),
        'y'.repeat(2600),
        `${KEYRING_PARTS_TAG}raw`,
        'short again',
      ]) {
        await store.store(account, value)
        expect(await store.get(account)).toBe(value)
      }
      const shortEntries = await findCredentialsAsync(service)
      expect(shortEntries.map((entry) => entry.account)).toEqual([account])
      await store.store(account, 'p'.repeat(2500))
      const longEntries = await findCredentialsAsync(service)
      const part_ = longEntries.find((entry) => entry.account.startsWith(`${account}#`))
      const part = part_
      if (part === undefined) throw new Error('long value has no native parts')
      await new AsyncEntry(service, part.account).setPassword('changed')
      await expect(store.get(account)).rejects.toBeInstanceOf(StoreUnavailableError)
      await new AsyncEntry(service, part.account).deletePassword()
      await expect(store.get(account)).rejects.toBeInstanceOf(StoreUnavailableError)
      await store.delete(account)
      expect(await store.get(account)).toBeUndefined()
      expect(await findCredentialsAsync(service)).toEqual([])
    } finally {
      const remaining = await findCredentialsAsync(service)
      for (const entry of remaining) {
        await new AsyncEntry(service, entry.account).deletePassword()
      }
    }
  })
})
