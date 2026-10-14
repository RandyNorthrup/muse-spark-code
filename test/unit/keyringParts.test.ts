// The OS credential store keeps secrets longer than one entry holds (F78):
// Windows Credential Manager refuses more than 1,280 characters per entry
// (measured 2026-10-14 through @napi-rs/keyring), and a ChatGPT plan record
// is longer. The store below stands in for the operating system only (the
// outside world): it refuses what Windows refuses, word for word. The last
// case runs the real Windows store with throwaway values.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  keyringSecretStore,
  StoreUnavailableError,
  type KeyringEntry,
} from '../../src/runtime/keyStore'
import { KEYRING_PART_CHARS, KEYRING_PARTS_TAG, KEYRING_SERVICE } from '../../src/shared/constants'

const WINDOWS_ENTRY_CHARS = 1280

/** Windows Credential Manager's behaviour as measured: values over 1,280 characters are refused. */
function windowsLikeStore(): {
  entries: Map<string, string>
  open: (service: string, account: string) => KeyringEntry
} {
  // Keyed by account: every entry the agent opens belongs to its one service.
  const entries = new Map<string, string>()
  return {
    entries,
    open: (service, account) => {
      if (service !== KEYRING_SERVICE) throw new Error(`unexpected service ${service}`)
      const id = account
      return {
        getPassword: () => Promise.resolve(entries.get(id) ?? null),
        setPassword: (password) => {
          if (password.length > WINDOWS_ENTRY_CHARS) {
            return Promise.reject(
              new Error(
                "Value of 'password encoded as UTF-16' is longer than the platform limit of 2560 chars",
              ),
            )
          }
          entries.set(id, password)
          return Promise.resolve()
        },
        deletePassword: () => Promise.resolve(entries.delete(id)),
      }
    },
  }
}

/** The first part entry of a key, or '' when it has none. */
function firstPartOf(entries: Map<string, string>, key: string): string {
  for (const account of entries.keys()) {
    if (account.startsWith(`${key}#`)) return account
  }
  return ''
}

describe('the OS credential store keeps long secrets as parts (F78)', () => {
  it('keeps a short value in one entry exactly as before', async () => {
    const os = windowsLikeStore()
    const store = keyringSecretStore(os.open)
    await store.store('museSpark.provider.chatgpt', 'short')
    expect(os.entries.get('museSpark.provider.chatgpt')).toBe('short')
    expect(await store.get('museSpark.provider.chatgpt')).toBe('short')
  })

  it('keeps a value Windows refuses in one entry as parts behind a header, and reads it back', async () => {
    const os = windowsLikeStore()
    const store = keyringSecretStore(os.open)
    const value = 'a'.repeat(1000) + 'b'.repeat(1500) + 'c'.repeat(700)
    await store.store('museSpark.provider.chatgpt', value)
    const header = os.entries.get('museSpark.provider.chatgpt') ?? ''
    expect(header.startsWith(KEYRING_PARTS_TAG)).toBe(true)
    expect(header.length).toBeLessThanOrEqual(WINDOWS_ENTRY_CHARS)
    expect(os.entries.size).toBe(1 + Math.ceil(value.length / KEYRING_PART_CHARS))
    expect(await store.get('museSpark.provider.chatgpt')).toBe(value)
  })

  it('replaces parts with a new long value and removes the old ones, also when the new value is short', async () => {
    const os = windowsLikeStore()
    const store = keyringSecretStore(os.open)
    await store.store('k', 'x'.repeat(3000))
    await store.store('k', 'y'.repeat(2600))
    expect(await store.get('k')).toBe('y'.repeat(2600))
    expect(os.entries.size).toBe(1 + Math.ceil(2600 / KEYRING_PART_CHARS))
    await store.store('k', 'short again')
    expect(os.entries.size).toBe(1)
    expect(os.entries.has('k')).toBe(true)
    expect(await store.get('k')).toBe('short again')
  })

  it('deletes the header and every part', async () => {
    const os = windowsLikeStore()
    const store = keyringSecretStore(os.open)
    await store.store('k', 'z'.repeat(4000))
    await store.delete('k')
    expect(os.entries.size).toBe(0)
    expect(await store.get('k')).toBeUndefined()
  })

  it('never reads a short value that starts with the parts tag as a header', async () => {
    const os = windowsLikeStore()
    const store = keyringSecretStore(os.open)
    const tricky = `${KEYRING_PARTS_TAG}1:${'0'.repeat(64)}`
    await store.store('k', tricky)
    expect(await store.get('k')).toBe(tricky)
  })

  it('refuses a changed or missing part instead of returning a wrong secret', async () => {
    const os = windowsLikeStore()
    const store = keyringSecretStore(os.open)
    await store.store('k', 'p'.repeat(2500))
    const partId = firstPartOf(os.entries, 'k')
    expect(partId).not.toBe('')
    os.entries.set(partId, 'q'.repeat(KEYRING_PART_CHARS))
    await expect(store.get('k')).rejects.toBeInstanceOf(StoreUnavailableError)
    os.entries.delete(partId)
    await expect(store.get('k')).rejects.toBeInstanceOf(StoreUnavailableError)
  })

  it.runIf(process.platform === 'win32')(
    'keeps a 3,000-character secret in the real Windows Credential Manager',
    async () => {
      const { AsyncEntry } = await import('@napi-rs/keyring')
      const store = keyringSecretStore(
        (service, account) =>
          new AsyncEntry(service, account, { linux: { store: 'secret-service' } }),
      )
      const account = `museSpark.test.keyringParts.${randomUUID()}`
      const value = `${randomUUID()}${'w'.repeat(3000)}`
      try {
        await store.store(account, value)
        expect(await store.get(account)).toBe(value)
      } finally {
        await store.delete(account)
      }
      expect(await store.get(account)).toBeUndefined()
    },
  )
})
