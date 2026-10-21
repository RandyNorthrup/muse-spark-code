// Removal with Undo (src/host/providers/providerRemoval.ts): a failure
// already reached its caller never breaks the chain behind it; a secret
// the window's end cannot delete stays pending for the next start; the
// next start attempts every pending secret and throws naming the ids
// that survived.
import { describe, expect, it } from 'vitest'
import {
  createProviderRemoval,
  type PendingRemoval,
  type ProviderRemovalDeps,
  type RemovalClock,
  type RemovalStore,
} from '../../src/host/providers/providerRemoval'
import type { ProviderEntry, ProvidersStore } from '../../src/host/providers/providerPorts'
import type { RecordStore } from '../../src/host/providers/credentialRecords'

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
  const scheduled: (() => void)[] = []
  const clock: RemovalClock = {
    now: () => 0,
    schedule: (_ms, run) => {
      scheduled.push(run)
      return { cancel: () => undefined }
    },
  }
  const deps: ProviderRemovalDeps = {
    providers,
    secrets: recordStore,
    pending: removalStore,
    clock,
    undoWindowMs: 1000,
  }
  return {
    deps,
    scheduled,
    attempts,
    pending: () => pending,
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
    expect(harness.scheduled).toHaveLength(1)
    harness.failSecretDelete('a')
    harness.scheduled[0]?.()
    // The window end's failure is the pending the next start retries.
    await expect(removal.completePending()).rejects.toThrow('a')
    expect(harness.pending().map((removal) => removal.entry.id)).toEqual(['a'])
    harness.failSecretDelete(undefined)
    await removal.completePending()
    expect(harness.pending()).toEqual([])
  })

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
