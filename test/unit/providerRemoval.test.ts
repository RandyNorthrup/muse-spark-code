// M95 lane K (PLAN.md D74, M95 acceptance 15): a removal waits behind Undo
// before its secret is deleted, and a closed window's removals complete at
// the next start.

import { describe, expect, it, vi } from 'vitest'
import {
  createProviderRemoval,
  type RemovalClock,
  type RemovalStore,
} from '../../src/host/providers/providerRemoval'
import { memoryProvidersStore, memorySecrets } from './helpers/fakes'
import type { ProviderEntry, ProvidersStore } from '../../src/host/providers/providerPorts'
import { saveProviderCredential } from '../../src/host/providers/credentialRecords'

const ENTRY: ProviderEntry = {
  id: 'openrouter',
  preset: 'openrouter',
  address: 'https://openrouter.ai',
  auth: 'apiKey',
  models: ['openai/gpt-oss-20b'],
}

const memoryProviders = memoryProvidersStore

function manualClock(): RemovalClock & {
  readonly scheduled: { ms: number; run: () => void }[]
  setNow(value: number): void
} {
  const scheduled: { ms: number; run: () => void }[] = []
  let now = 1_000_000
  return {
    scheduled,
    now: () => now,
    setNow: (value) => {
      now = value
    },
    schedule: (ms, run) => {
      const task = { ms, run }
      scheduled.push(task)
      return {
        cancel: () => {
          const index = scheduled.indexOf(task)
          if (index !== -1) {
            scheduled.splice(index, 1)
          }
        },
      }
    },
  }
}

function makeRemoval(parts: {
  readonly providers?: ProvidersStore
  readonly clock?: RemovalClock
}): ReturnType<typeof createProviderRemoval> & {
  readonly secrets: ReturnType<typeof memorySecrets>
} {
  const secrets = memorySecrets()
  let pending: { entry: ProviderEntry; removedAt: number }[] = []
  const store: RemovalStore = {
    load: () => Promise.resolve([...pending]),
    save: (next) => {
      pending = [...next]
      return Promise.resolve()
    },
  }
  return {
    secrets,
    ...createProviderRemoval({
      providers: parts.providers ?? memoryProviders([ENTRY]),
      secrets,
      pending: store,
      clock: parts.clock ?? manualClock(),
      undoWindowMs: 10_000,
    }),
  }
}

describe('provider removal with undo', () => {
  it('keeps a replacement providers new key at the old deadline and restart', async () => {
    const clock = manualClock()
    const providers = memoryProviders([ENTRY])
    const active = makeRemoval({ providers, clock })
    await active.remove(ENTRY.id)
    await providers.add(ENTRY)
    await saveProviderCredential(active.secrets, ENTRY.id, {
      v: 1,
      auth: 'apiKey',
      origin: ENTRY.address,
      secret: 'new-generation-key',
    })
    clock.scheduled[0]?.run()
    await active.completePending()
    expect(await active.secrets.get('museSpark.provider.openrouter')).toContain(
      'new-generation-key',
    )
    expect(await active.undo(ENTRY.id)).toBe(false)
  })
  it('removes the entry at once but deletes the secret after its window', async () => {
    const clock = manualClock()
    const removal = makeRemoval({ clock })
    await removal.secrets.store('x', 'y')
    await saveProviderCredential(removal.secrets, 'openrouter', {
      v: 1,
      auth: 'apiKey',
      origin: 'https://openrouter.ai',
      secret: 'sk-or-test-key',
    })
    const removed = await removal.remove('openrouter')
    expect(removed).toEqual(ENTRY)
    expect(clock.scheduled).toHaveLength(1)
    // The secret survives until the window passes.
    expect(await removal.secrets.get('museSpark.provider.openrouter')).not.toBeUndefined()
    clock.scheduled[0]?.run()
    await vi.waitFor(async () => {
      expect(await removal.secrets.get('museSpark.provider.openrouter')).toBeUndefined()
    })
  })

  it('answers undefined for a provider that is not configured', async () => {
    const removal = makeRemoval({})
    await expect(removal.remove('groq')).resolves.toBeUndefined()
  })

  it('restores the provider with its key inside the window', async () => {
    const clock = manualClock()
    const providers = memoryProviders([ENTRY])
    const active = makeRemoval({ providers, clock })
    await saveProviderCredential(active.secrets, 'openrouter', {
      v: 1,
      auth: 'apiKey',
      origin: 'https://openrouter.ai',
      secret: 'sk-or-test-key',
    })
    await active.remove('openrouter')
    expect(providers.current).toHaveLength(0)
    expect(await active.undo('openrouter')).toBe(true)
    expect(providers.current).toEqual([ENTRY])
    expect(await active.secrets.get('museSpark.provider.openrouter')).not.toBeUndefined()
    expect(clock.scheduled).toHaveLength(0)
  })

  it('refuses undo after the window and for unknown removals', async () => {
    const clock = manualClock()
    const active = makeRemoval({ clock })
    await active.remove('openrouter')
    clock.setNow(1_000_000 + 10_001)
    expect(await active.undo('openrouter')).toBe(false)
    expect(await active.undo('groq')).toBe(false)
  })
})

describe('completePending', () => {
  it('deletes the secrets a closed window left behind', async () => {
    const secrets = memorySecrets()
    await saveProviderCredential(secrets, 'openrouter', {
      v: 1,
      auth: 'apiKey',
      origin: 'https://openrouter.ai',
      secret: 'sk-or-test-key',
    })
    let pending = [{ entry: ENTRY, removedAt: 1 }]
    const active = createProviderRemoval({
      providers: memoryProviders([]),
      secrets,
      pending: {
        load: () => Promise.resolve(pending),
        save: (next) => {
          pending = [...next]
          return Promise.resolve()
        },
      },
      clock: manualClock(),
      undoWindowMs: 10_000,
    })
    await active.completePending()
    expect(await secrets.get('museSpark.provider.openrouter')).toBeUndefined()
    expect(pending).toEqual([])
  })

  it('names the secrets that survived, after attempting them all', async () => {
    const secrets = {
      get: () => Promise.resolve(undefined),
      store: () => Promise.resolve(),
      delete: () => Promise.reject(new Error('locked')),
    }
    const pending = [
      { entry: ENTRY, removedAt: 1 },
      {
        entry: { ...ENTRY, id: 'groq', address: 'https://api.groq.com' },
        removedAt: 1,
      },
    ]
    const active = createProviderRemoval({
      providers: memoryProviders([]),
      secrets,
      pending: {
        load: () => Promise.resolve(pending),
        save: () => Promise.resolve(),
      },
      clock: manualClock(),
      undoWindowMs: 10_000,
    })
    await expect(active.completePending()).rejects.toThrow('openrouter, groq')
  })
})
