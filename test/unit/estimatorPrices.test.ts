import { describe, expect, it, vi } from 'vitest'
import {
  lookupEstimatePrices,
  type EstimatePriceLookup,
  type EstimatePricePort,
  type EstimatePrices,
} from '../../src/core/estimator/prices'
import { ESTIMATE_MAX_ITEMS } from '../../src/shared/constants'
import { catalogPrice } from './helpers/estimatorRecommendFixtures'

const CATALOG = 'https://catalog.invalid/sizes'
const AS_OF = '2026-10-06T12:00:00.000Z'
const options = (): EstimatePriceLookup => ({
  asOf: AS_OF,
  enabled: true,
  networkAllowed: true,
  maxAgeMs: 60_000,
  catalogUrls: [CATALOG],
})
const document = (retrievedAt = AS_OF) => ({
  retrievedAt,
  catalogDate: '2026-10-06',
  etag: '"fixture-v1"',
  rows: [{ classId: 'linux-x64-builder', price: catalogPrice() }],
})
function ports(cache?: unknown, response?: unknown) {
  const reply = response ?? {
    status: 'modified',
    catalogDate: '2026-10-06',
    etag: '"fixture-v1"',
    rows: document().rows,
  }
  const cached = vi.fn(() => Promise.resolve(cache))
  const store = vi.fn<EstimatePricePort['store']>(() => Promise.resolve())
  const fetchPublic = vi.fn(() => Promise.resolve(reply))
  const port: EstimatePricePort = { cached, store, fetchPublic }
  return { port, cached, store, fetchPublic }
}

function expectRefusedCatalog(
  result: EstimatePrices,
  store: ReturnType<typeof ports>['store'],
): void {
  expect(result).toEqual({
    rows: [],
    sources: [],
    unavailable: [{ catalogUrl: CATALOG, reason: 'invalidCatalog' }],
  })
  expect(store).not.toHaveBeenCalled()
}

describe('M117 dated public catalog lookup', () => {
  it('requires the optional lookup before any cache or network access', async () => {
    const fake = ports()
    expect(await lookupEstimatePrices({ ...options(), enabled: false }, fake.port)).toEqual({
      rows: [],
      sources: [],
      unavailable: [],
    })
    expect(fake.cached).not.toHaveBeenCalled()
    expect(fake.fetchPublic).not.toHaveBeenCalled()
    expect(fake.store).not.toHaveBeenCalled()
  })
  it('honors the resolved network setting and terminal floor before dispatch', async () => {
    const fake = ports()
    const result = await lookupEstimatePrices({ ...options(), networkAllowed: false }, fake.port)
    expect(result.rows).toEqual([])
    expect(result.unavailable).toEqual([{ catalogUrl: CATALOG, reason: 'networkOff' }])
    expect(fake.fetchPublic).not.toHaveBeenCalled()
    expect(fake.store).not.toHaveBeenCalled()
  })
  it('returns no price without a validated public catalog, preserving its date and source', async () => {
    const fake = ports()
    const result = await lookupEstimatePrices(options(), fake.port)
    expect(result.rows).toEqual(document().rows)
    expect(result.sources).toEqual([
      {
        catalogUrl: CATALOG,
        catalogDate: '2026-10-06',
        retrievedAt: AS_OF,
        freshness: 'fresh',
        via: 'network',
      },
    ])
    expect(fake.fetchPublic).toHaveBeenCalledWith(CATALOG, undefined)
    expect(fake.store).toHaveBeenCalledWith(CATALOG, document())
  })
  it('uses the injected freshness boundary without refreshing a fresh cache', async () => {
    const cached = document('2026-10-06T11:59:00.000Z')
    const fake = ports(cached)
    const result = await lookupEstimatePrices(options(), fake.port)
    expect(result.sources[0]!.via).toBe('cache')
    expect(result.sources[0]!.freshness).toBe('fresh')
    expect(fake.fetchPublic).not.toHaveBeenCalled()
    expect(fake.store).not.toHaveBeenCalled()
  })
  it('keeps the dated stale cache visible offline without implying current pricing', async () => {
    const cached = document('2026-10-06T11:58:00.000Z')
    const fake = ports(cached)
    const result = await lookupEstimatePrices({ ...options(), networkAllowed: false }, fake.port)
    expect(result.rows).toEqual(cached.rows)
    expect(result.sources[0]).toEqual({
      catalogUrl: CATALOG,
      catalogDate: '2026-10-06',
      retrievedAt: cached.retrievedAt,
      freshness: 'stale',
      via: 'cache',
    })
    expect(fake.fetchPublic).not.toHaveBeenCalled()
  })
  it('conditionally revalidates an old entry while retaining its actual catalog date', async () => {
    const cached = document('2026-10-06T11:58:00.000Z')
    cached.catalogDate = '2026-10-05'
    cached.rows[0]!.price.catalogDate = '2026-10-05'
    const fake = ports(cached, { status: 'notModified' })
    const result = await lookupEstimatePrices(options(), fake.port)
    expect(fake.fetchPublic).toHaveBeenCalledWith(CATALOG, cached.etag)
    expect(fake.store).toHaveBeenCalledWith(CATALOG, { ...cached, retrievedAt: AS_OF })
    expect(result.sources[0]).toEqual({
      catalogUrl: CATALOG,
      catalogDate: '2026-10-05',
      retrievedAt: AS_OF,
      freshness: 'fresh',
      via: 'revalidated',
    })
    expect(result.rows[0]!.price.catalogDate).toBe('2026-10-05')
  })
  it('refuses not-modified when there is no trustworthy cached evidence', async () => {
    const fake = ports(undefined, { status: 'notModified' })
    const result = await lookupEstimatePrices(options(), fake.port)
    expectRefusedCatalog(result, fake.store)
  })
  it('refreshes a stale entry with validated new rows and drops a removed ETag', async () => {
    const cached = document('2026-10-06T11:58:00.000Z')
    const rows = [{ classId: 'linux-x64-builder', price: catalogPrice(0.04) }]
    const fake = ports(cached, { status: 'modified', catalogDate: '2026-10-06', rows })
    const result = await lookupEstimatePrices(options(), fake.port)
    expect(result.rows).toEqual(rows)
    expect(fake.store).toHaveBeenCalledWith(CATALOG, {
      retrievedAt: AS_OF,
      catalogDate: '2026-10-06',
      rows,
    })
    expect(result.sources[0]!.via).toBe('network')
  })
  it('retains good cache on a transport, response-validation or persistence failure', async () => {
    const cached = document('2026-10-06T11:58:00.000Z')
    const network = ports(cached)
    network.fetchPublic.mockRejectedValue(new Error('private account text'))
    const invalid = ports(cached, { status: 'modified', catalogDate: 'tomorrow', rows: [] })
    const storage = ports(cached)
    storage.store.mockRejectedValue(new Error('private path'))
    for (const fake of [network, invalid, storage]) {
      const result = await lookupEstimatePrices(options(), fake.port)
      expect(result.rows).toEqual(cached.rows)
      expect(result.sources[0]!.via).toBe('cache')
      expect(result.sources[0]!.freshness).toBe('stale')
      expect(result.unavailable).toHaveLength(1)
      expect(JSON.stringify(result)).not.toContain('private')
    }
  })
  it.each([
    'public',
    'origin',
    'date',
    'future',
    'class',
    'duplicate',
    'extra',
    'negative',
    'credential',
  ])('refuses invalid %s evidence before caching or displaying a price', async (fault) => {
    const rows = document().rows
    let date = '2026-10-06'
    switch (fault) {
      case 'public': {
        Reflect.set(rows[0]!.price, 'publicCatalog', false)
        break
      }
      case 'origin': {
        rows[0]!.price.catalogUrl = 'https://other.invalid/sizes'
        break
      }
      case 'date': {
        rows[0]!.price.catalogDate = '2026-10-05'
        break
      }
      case 'future': {
        date = '2026-10-07'
        rows[0]!.price.catalogDate = date
        break
      }
      case 'class': {
        rows[0]!.classId = 'unknown-class'
        break
      }
      case 'duplicate': {
        rows.push(structuredClone(rows[0]!))
        break
      }
      case 'extra': {
        Reflect.set(rows[0]!.price, 'account', 'private')
        break
      }
      case 'negative': {
        rows[0]!.price.hourlyUsd = -1
        break
      }
      case 'credential': {
        rows[0]!.price.catalogUrl = 'https://user@catalog.invalid/sizes'
        break
      }
    }
    const fake = ports(undefined, { status: 'modified', catalogDate: date, rows })
    const result = await lookupEstimatePrices(options(), fake.port)
    expectRefusedCatalog(result, fake.store)
  })
  it('rejects poisoned/future caches and never returns their prices offline', async () => {
    const caches = [
      { ...document(), retrievedAt: '2026-10-06T13:00:00.000Z' },
      { ...document(), catalogDate: '2026-10-07' },
      { ...document(), rows: [{ classId: 'unknown', price: catalogPrice() }] },
      { ...document(), account: 'private' },
    ]
    for (const cache of caches) {
      const fake = ports(cache)
      const result = await lookupEstimatePrices({ ...options(), networkAllowed: false }, fake.port)
      expect(result.rows).toEqual([])
      expect(result.unavailable[0]!.reason).toBe('invalidCatalog')
      expect(fake.fetchPublic).not.toHaveBeenCalled()
    }
  })
  it('isolates a cache read failure and can still use an allowed public catalog', async () => {
    const offline = ports()
    offline.cached.mockRejectedValue(new Error('private cache path'))
    const refused = await lookupEstimatePrices(
      { ...options(), networkAllowed: false },
      offline.port,
    )
    expect(refused.unavailable).toEqual([{ catalogUrl: CATALOG, reason: 'unavailable' }])
    expect(offline.fetchPublic).not.toHaveBeenCalled()
    const online = ports()
    online.cached.mockRejectedValue(new Error('private cache path'))
    expect(await lookupEstimatePrices(options(), online.port)).toEqual({
      rows: document().rows,
      sources: [
        {
          catalogUrl: CATALOG,
          catalogDate: '2026-10-06',
          retrievedAt: AS_OF,
          freshness: 'fresh',
          via: 'network',
        },
      ],
      unavailable: [],
    })
  })
  it('refuses one provider size mapped to conflicting machine classes', async () => {
    const rows = document().rows
    rows.push({ ...structuredClone(rows[0]!), classId: 'linux-arm64-builder' })
    const fake = ports(undefined, { status: 'modified', catalogDate: '2026-10-06', rows })
    const result = await lookupEstimatePrices(options(), fake.port)
    expect(result.rows).toEqual([])
    expect(fake.store).not.toHaveBeenCalled()
  })
  it('replaces a poisoned cache only with new validated catalog evidence', async () => {
    const fake = ports({ ...document(), retrievedAt: '2026-10-07T12:00:00.000Z' })
    const result = await lookupEstimatePrices(options(), fake.port)
    expect(fake.fetchPublic).toHaveBeenCalledWith(CATALOG, undefined)
    expect(result.rows).toEqual(document().rows)
    expect(result.sources[0]!.via).toBe('network')
  })
  it('reports an explicitly empty public catalog and permits a real zero public rate', async () => {
    const empty = ports(undefined, { status: 'modified', catalogDate: '2026-10-06', rows: [] })
    const result = await lookupEstimatePrices(options(), empty.port)
    expect(result.rows).toEqual([])
    expect(result.unavailable).toEqual([{ catalogUrl: CATALOG, reason: 'emptyCatalog' }])
    const free = ports(undefined, {
      status: 'modified',
      catalogDate: '2026-10-06',
      rows: [{ classId: 'linux-x64-builder', price: catalogPrice(0) }],
    })
    const freeResult = await lookupEstimatePrices(options(), free.port)
    expect(freeResult.rows[0]!.price.hourlyUsd).toBe(0)
  })
  it('sorts catalog and size identities independently of input order and never mutates cached bytes', async () => {
    const second = 'https://second.invalid/sizes'
    const cache = document()
    const before = JSON.stringify(cache)
    const fake = ports(cache)
    const first = await lookupEstimatePrices(
      { ...options(), networkAllowed: false, catalogUrls: [second, CATALOG] },
      fake.port,
    )
    const next = await lookupEstimatePrices(
      { ...options(), networkAllowed: false, catalogUrls: [CATALOG, second] },
      fake.port,
    )
    expect(next).toEqual(first)
    first.rows[0]!.price.hourlyUsd = 5
    expect(JSON.stringify(cache)).toBe(before)
    expect(next.rows[0]!.price.hourlyUsd).toBe(0.02)
  })
  it('keeps the persisted snapshot independent of returned price mutations', async () => {
    const fake = ports()
    const result = await lookupEstimatePrices(options(), fake.port)
    const stored = fake.store.mock.calls[0]![1]
    result.rows[0]!.price.hourlyUsd = 5
    expect(stored.rows[0]!.price.hourlyUsd).toBe(0.02)
  })
  it('validates options, bounded catalogs/rows, HTTPS and credentials before accessing ports', async () => {
    const fake = ports()
    for (const bad of [
      { ...options(), asOf: 'not-a-date' },
      { ...options(), maxAgeMs: -1 },
      { ...options(), maxAgeMs: Infinity },
      { ...options(), catalogUrls: [CATALOG, CATALOG] },
      { ...options(), catalogUrls: [CATALOG.replace('https:', 'http:')] },
      { ...options(), catalogUrls: ['https://user@catalog.invalid/'] },
      { ...options(), catalogUrls: ['https://catalog.invalid/#fragment'] },
      { ...options(), catalogUrls: ['garbage'] },
      {
        ...options(),
        catalogUrls: Array.from(
          { length: ESTIMATE_MAX_ITEMS + 1 },
          (_, index) => `https://catalog-${String(index)}.invalid/`,
        ),
      },
    ])
      await expect(lookupEstimatePrices(bad, fake.port)).rejects.toThrow()
    expect(fake.cached).not.toHaveBeenCalled()
    expect(fake.fetchPublic).not.toHaveBeenCalled()
    const rows = Array.from({ length: ESTIMATE_MAX_ITEMS + 1 }, (_, index) => ({
      classId: 'linux-x64-builder',
      price: { ...catalogPrice(), sizeId: `size-${String(index)}` },
    }))
    const many = ports(undefined, { status: 'modified', catalogDate: '2026-10-06', rows })
    const bounded = await lookupEstimatePrices(options(), many.port)
    expect(bounded.unavailable[0]!.reason).toBe('invalidCatalog')
  })
})
