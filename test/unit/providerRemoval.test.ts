// Removal with Undo (src/host/providers/providerRemoval.ts): a failure
// already reached its caller never breaks the chain behind it; a secret
// the window's end cannot delete stays pending for the next start; the
// next start attempts every pending secret and throws naming the ids
// that survived. The clock is the real process clock: expired windows are
// backdated pendings, and the live ten seconds wait for real. The
// providers and pending stores stay list-backed (VS Code global state in
// production) and secrets stay Map-backed (the OS store is unownable).
import { describe, expect, it, vi } from 'vitest'
import {
  createProviderRemoval,
  systemRemovalClock,
  type PendingRemoval,
  type ProviderRemovalDeps,
  type RemovalStore,
} from '../../src/host/providers/providerRemoval'
import type { ProviderEntry, ProvidersStore } from '../../src/host/providers/providerPorts'
import {
  readProviderAdminCredential,
  readProviderCredential,
  saveProviderAdminCredential,
  saveProviderCredential,
  type CredentialRecord,
  type RecordStore,
} from '../../src/host/providers/credentialRecords'
import { PROVIDER_UNDO_WINDOW_MS } from '../../src/shared/constants'

// The live-window test waits out the production ten-second Undo window
// for real: twice the window covers a loaded rig without hiding a timer
// that never finishes.
const LIVE_WINDOW_TIMEOUT_MS = 2 * PROVIDER_UNDO_WINDOW_MS

const INFERENCE_RECORD: CredentialRecord = {
  v: 1,
  auth: 'apiKey',
  origin: 'https://api.anthropic.com',
  secret: 'TEST-INFERENCE-KEY',
}
const ADMIN_RECORD: CredentialRecord = {
  v: 1,
  auth: 'apiKey',
  origin: 'https://api.anthropic.com',
  secret: 'TEST-ADMIN-KEY',
}

function entry(id: string): ProviderEntry {
  return { id, preset: 'preset', address: 'http://127.0.0.1:1/', auth: 'none', models: [] }
}

function stores() {
  let entries: ProviderEntry[] = [entry('a'), entry('b')]
  let shouldFailRemove = false
  const providers: ProvidersStore = {
    validate: () => undefined,
    list: () => Promise.resolve([...entries]),
    add: () => Promise.resolve(),
    remove: (id) => {
      if (shouldFailRemove) {
        return Promise.reject(new Error('providers file is down'))
      }
      const found = entries.find((candidate) => candidate.id === id)
      entries = entries.filter((candidate) => candidate.id !== id)
      return Promise.resolve(found)
    },
    restore: (restored) => {
      entries = [...entries, restored]
      return Promise.resolve()
    },
    replaceAll: () => Promise.resolve([]),
    defaultModel: () => Promise.resolve(undefined),
    setDefaultModel: () => Promise.resolve(),
  }
  const secrets = new Map<string, string>()
  let failDelete: string | undefined
  const attempts: string[] = []
  const recordStore: RecordStore = {
    get: (key) => Promise.resolve(secrets.get(key)),
    store: (key, value) => {
      secrets.set(key, value)
      return Promise.resolve()
    },
    delete: (key) => {
      attempts.push(key)
      if (failDelete !== undefined) {
        return Promise.reject(new Error(`secret store is down for ${failDelete}`))
      }
      secrets.delete(key)
      return Promise.resolve()
    },
  }
  let pending: readonly PendingRemoval[] = []
  const removalStore: RemovalStore = {
    load: () => Promise.resolve(pending),
    save: (kept) => {
      pending = kept
      return Promise.resolve()
    },
  }
  const clock = systemRemovalClock()
  const deps: ProviderRemovalDeps = {
    providers,
    secrets: recordStore,
    pending: removalStore,
    clock,
  }
  return {
    deps,
    attempts,
    pending: () => pending,
    backdate: (id: string, removedAt: number) => {
      pending = pending.map((removal) =>
        removal.entry.id === id ? { ...removal, removedAt } : removal,
      )
    },
    failRemovals: (shouldFail: boolean) => {
      shouldFailRemove = shouldFail
    },
    failSecretDelete: (id: string | undefined) => {
      failDelete = id
    },
  }
}

describe('createProviderRemoval', () => {
  it('keeps the chain alive after a failure already reached its caller', async () => {
    const harness = stores()
    const removal = createProviderRemoval(harness.deps)
    harness.failRemovals(true)
    await expect(removal.remove('a')).rejects.toThrow('providers file is down')
    harness.failRemovals(false)
    const restored = await removal.remove('a')
    expect(restored?.id).toBe('a')
    expect(harness.pending().map((removal) => removal.entry.id)).toEqual(['a'])
  })

  it('keeps a secret the window end cannot delete for the next start', async () => {
    const harness = stores()
    const removal = createProviderRemoval(harness.deps)
    await removal.remove('a')
    harness.failSecretDelete('a')
    // The next start's retry keeps the secret it cannot delete.
    await expect(removal.completePending()).rejects.toThrow('a')
    expect(harness.pending().map((removal) => removal.entry.id)).toEqual(['a'])
    harness.failSecretDelete(undefined)
    await removal.completePending()
    expect(harness.pending()).toEqual([])
  })

  it('restores a removed provider while its window is open', async () => {
    const harness = stores()
    const removal = createProviderRemoval(harness.deps)
    await removal.remove('a')
    expect(await removal.undo('a')).toBe(true)
    expect(harness.pending()).toEqual([])
  })

  it('refuses to restore once the window has passed', async () => {
    const harness = stores()
    const removal = createProviderRemoval(harness.deps)
    await removal.remove('a')
    harness.backdate('a', Date.now() - 2 * PROVIDER_UNDO_WINDOW_MS)
    expect(await removal.undo('a')).toBe(false)
    expect(harness.pending().map((removal) => removal.entry.id)).toEqual(['a'])
  })

  it(
    'deletes both secrets when the live window ends',
    { timeout: LIVE_WINDOW_TIMEOUT_MS },
    async () => {
      const harness = stores()
      const removal = createProviderRemoval(harness.deps)
      await saveProviderCredential(harness.deps.secrets, 'a', INFERENCE_RECORD)
      await saveProviderAdminCredential(harness.deps.secrets, 'a', ADMIN_RECORD)
      await removal.remove('a')
      expect(await readProviderCredential(harness.deps.secrets, 'a')).toEqual(INFERENCE_RECORD)
      await vi.waitFor(
        async () => {
          expect(await readProviderCredential(harness.deps.secrets, 'a')).toBeUndefined()
        },
        { timeout: LIVE_WINDOW_TIMEOUT_MS, interval: 100 },
      )
      expect(await readProviderAdminCredential(harness.deps.secrets, 'a')).toBeUndefined()
      expect(harness.pending()).toEqual([])
    },
  )

  it('attempts every pending secret and throws naming the survivors', async () => {
    const harness = stores()
    const removal = createProviderRemoval(harness.deps)
    await removal.remove('a')
    await removal.remove('b')
    harness.failSecretDelete('all')
    let failure: unknown
    try {
      await removal.completePending()
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('a')
    expect((failure as Error).message).toContain('b')
    expect(harness.attempts).toHaveLength(2)
    expect(harness.pending().map((pending) => pending.entry.id)).toEqual(['a', 'b'])
  })
})
