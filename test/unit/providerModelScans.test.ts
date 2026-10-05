// M95 lane K (PLAN.md D74, M95 acceptance 17 and Tests: scan diffs): scans
// are cached with their time, reused while fresh, single-flight per
// provider, cancellable to the last scan, and diffed exactly.

import { describe, expect, it, vi } from 'vitest'
import {
  createModelScanner,
  diffScans,
  scanDiffLines,
  type ModelScan,
  type ScanStore,
} from '../../src/host/providers/modelScans'
import type {
  ModelFetcher,
  ProviderEntry,
  ProviderModelRow,
} from '../../src/host/providers/providerPorts'

function row(id: string, priceFingerprint = 'p1'): ProviderModelRow {
  return {
    id,
    label: id,
    toolCapable: true,
    vision: false,
    reasoning: false,
    context: 128_000,
    priceFingerprint,
    isFree: false,
    isLocal: false,
  }
}

const ENTRY: ProviderEntry = {
  id: 'openrouter',
  presetId: 'openrouter',
  address: 'https://openrouter.ai',
  auth: 'oauth',
  models: [],
}

function memoryStore(scans: readonly ModelScan[] = []): ScanStore & { saved: ModelScan[][] } {
  let current = [...scans]
  const saved: ModelScan[][] = []
  return {
    saved,
    load: () => Promise.resolve(current),
    save: (next) => {
      current = [...next]
      saved.push([...next])
      return Promise.resolve()
    },
  }
}

function scanner(
  rows: readonly ProviderModelRow[],
  store: ScanStore,
  fetch: Partial<ModelFetcher> = {},
): ReturnType<typeof createModelScanner> {
  return createModelScanner({
    fetch: { fetchModels: () => Promise.resolve({ rows }), ...fetch },
    credentialFor: () => Promise.resolve('credential'),
    store,
    now: () => 1_000_000,
    staleMs: 60_000,
  })
}

describe('diffScans', () => {
  it('names added, removed and repriced models', () => {
    expect(
      diffScans([row('a'), row('b', 'old'), row('gone')], [row('a'), row('b', 'new'), row('c')]),
    ).toEqual({ added: ['c'], removed: ['gone'], repriced: ['b'] })
  })

  it('compares ids exactly, not case-insensitively', () => {
    expect(diffScans([row('Model')], [row('model')])).toEqual({
      added: ['model'],
      removed: ['Model'],
      repriced: [],
    })
  })

  it('says the diff in words, and nothing when empty', () => {
    expect(scanDiffLines({ added: ['a', 'b', 'c'], removed: [], repriced: [] })).toEqual([
      '3 new models since the last scan',
    ])
    expect(scanDiffLines({ added: [], removed: ['a', 'b'], repriced: ['c', 'd'] })).toEqual([
      '2 models removed since the last scan',
      '2 models with a new price since the last scan',
    ])
    expect(scanDiffLines({ added: [], removed: [], repriced: [] })).toEqual([])
  })
})

describe('createModelScanner', () => {
  it('scans a new provider and caches the rows with their time', async () => {
    const store = memoryStore()
    const outcome = await scanner([row('a')], store).scan(ENTRY)
    expect(outcome).toEqual({ rows: [row('a')], diff: undefined, fromCache: false })
    expect(store.saved).toHaveLength(1)
    expect(store.saved[0]?.[0]).toMatchObject({ providerId: 'openrouter', fetchedAt: 1_000_000 })
  })

  it('reuses a fresh scan and refreshes a stale one with its diff', async () => {
    const store = memoryStore([
      { providerId: 'openrouter', fetchedAt: 999_000, catalogue: undefined, rows: [row('a')] },
    ])
    const fresh = await scanner([row('b')], store).scan(ENTRY)
    expect(fresh.fromCache).toBe(true)
    expect(fresh.rows).toEqual([row('a')])
    const stale = memoryStore([
      { providerId: 'openrouter', fetchedAt: 100_000, catalogue: undefined, rows: [row('a')] },
    ])
    const outcome = await scanner([row('a'), row('b')], stale).scan(ENTRY)
    expect(outcome.fromCache).toBe(false)
    expect(outcome.diff).toEqual({ added: ['b'], removed: [], repriced: [] })
  })

  it('stales on a newer catalogue snapshot', async () => {
    const fetchModels = vi.fn(() => Promise.resolve({ rows: [row('b')] }))
    const store = memoryStore([
      { providerId: 'openrouter', fetchedAt: 999_000, catalogue: 'v1', rows: [row('a')] },
    ])
    const outcome = await scanner([row('b')], store, { fetchModels }).scan(ENTRY, {
      catalogue: 'v2',
    })
    expect(fetchModels).toHaveBeenCalledOnce()
    expect(outcome.fromCache).toBe(false)
  })

  it('runs one scan per provider at a time', async () => {
    const fetchModels = vi.fn(() => Promise.resolve({ rows: [row('a')] }))
    const store = memoryStore()
    const active = scanner([row('a')], store, { fetchModels })
    const [first, second] = await Promise.all([active.scan(ENTRY), active.scan(ENTRY)])
    expect(fetchModels).toHaveBeenCalledOnce()
    expect(first.rows).toEqual(second.rows)
  })

  it('leaves the last scan on cancellation', async () => {
    const store = memoryStore([
      { providerId: 'openrouter', fetchedAt: 999_000, catalogue: undefined, rows: [row('old')] },
    ])
    let release!: () => void
    const gate = new Promise<{ rows: ProviderModelRow[] }>((resolve) => {
      release = () => {
        resolve({ rows: [row('new')] })
      }
    })
    const active = createModelScanner({
      fetch: { fetchModels: () => gate },
      credentialFor: () => Promise.resolve('credential'),
      store,
      now: () => 1_000_000,
      staleMs: 60_000,
    })
    const scanning = active.scan(ENTRY, { refresh: true })
    expect(active.cancelScan('openrouter')).toBe(true)
    expect(active.cancelScan('openrouter')).toBe(true)
    expect(active.cancelScan('other')).toBe(false)
    release()
    const outcome = await scanning
    expect(outcome).toEqual({ rows: [row('old')], diff: undefined, fromCache: true })
    expect(store.saved).toHaveLength(0)
  })

  it('fails a scan the provider refused', async () => {
    const store = memoryStore()
    const active = scanner([], store, {
      fetchModels: () => Promise.reject(new Error('Test failed: gone')),
    })
    await expect(active.scan(ENTRY)).rejects.toThrow('gone')
    // A failed scan leaves no cache: the next scan tries again.
    await expect(active.scan(ENTRY)).rejects.toThrow('gone')
  })
})
