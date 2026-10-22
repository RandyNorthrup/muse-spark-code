// The estimate price catalog lookup (D207): a missing cache entry is a cold
// cache the network refresh can rescue, while any other store failure keeps
// its kind for the caller instead of reading as merely unavailable.
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { lookupEstimatePrices, type EstimatePricePort } from '../../src/core/estimator/prices'
import { estimatePricePorts } from './helpers/estimateFailures'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { EN } from '../../src/shared/l10n/en'

const AS_OF = '2026-10-17T00:00:00.000Z'
const CATALOG_URL = 'https://example.com/catalog.json'

function filePort(directory: string): EstimatePricePort {
  return {
    cached: () => readFile(path.join(directory, 'catalog.json'), 'utf8'),
    store: () => Promise.resolve(),
    fetchPublic: () => Promise.reject(new Error('network off in this test')),
  }
}

async function removeFolder(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true })
}

describe('estimate price catalog cache', () => {
  it('reads a missing cache entry as a cold cache, not a failure', async () => {
    setUiText(EN, BASE_LOCALE)
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-estimate-prices-'))
    try {
      const result = await lookupEstimatePrices(
        {
          asOf: AS_OF,
          enabled: true,
          networkAllowed: false,
          maxAgeMs: 60_000,
          catalogUrls: [CATALOG_URL],
        },
        filePort(directory),
      )
      expect(result.rows).toEqual([])
      expect(result.unavailable).toEqual([{ catalogUrl: CATALOG_URL, reason: 'unavailable' }])
    } finally {
      await removeFolder(directory)
    }
  })

  it('keeps a non-missing store failure’s kind for the caller', async () => {
    setUiText(EN, BASE_LOCALE)
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-estimate-prices-'))
    try {
      // A directory where the cache file belongs: reading it fails with
      // EISDIR, a broken store rather than a cold cache.
      await mkdir(path.join(directory, 'catalog.json'))
      let failure: unknown
      try {
        await lookupEstimatePrices(
          {
            asOf: AS_OF,
            enabled: true,
            networkAllowed: false,
            maxAgeMs: 60_000,
            catalogUrls: [CATALOG_URL],
          },
          filePort(directory),
        )
      } catch (error: unknown) {
        failure = error
      }
      expect(failure instanceof Error && (failure as NodeJS.ErrnoException).code).toBe('EISDIR')
    } finally {
      await removeFolder(directory)
    }
  })

  it('refuses invalid lookup options before any cache or network access', async () => {
    setUiText(EN, BASE_LOCALE)
    let contacts = 0
    const port: EstimatePricePort = {
      cached: () => {
        contacts += 1
        return Promise.resolve(undefined)
      },
      store: () => Promise.resolve(),
      fetchPublic: () => Promise.reject(new Error('network must stay off')),
    }
    const base = {
      asOf: AS_OF,
      enabled: true,
      networkAllowed: false,
      maxAgeMs: 60_000,
      catalogUrls: [CATALOG_URL],
    }
    for (const options of [
      { ...base, maxAgeMs: NaN },
      { ...base, maxAgeMs: -1 },
      { ...base, catalogUrls: [CATALOG_URL, CATALOG_URL] },
      { ...base, catalogUrls: ['not a url'] },
    ]) {
      await expect(lookupEstimatePrices(options, port)).rejects.toThrow('catalog-options')
    }
    expect(contacts).toBe(0)
  })
  it('reads no port when the lookup is off, and names an offline cache miss', async () => {
    setUiText(EN, BASE_LOCALE)
    let contacts = 0
    const port: EstimatePricePort = {
      cached: () => {
        contacts += 1
        return Promise.resolve(undefined)
      },
      store: () => Promise.resolve(),
      fetchPublic: () => Promise.reject(new Error('network must stay off')),
    }
    const off = await lookupEstimatePrices(
      {
        asOf: AS_OF,
        enabled: false,
        networkAllowed: true,
        maxAgeMs: 60_000,
        catalogUrls: [CATALOG_URL],
      },
      port,
    )
    expect(off).toEqual({ rows: [], sources: [], unavailable: [] })
    const miss = await lookupEstimatePrices(
      {
        asOf: AS_OF,
        enabled: true,
        networkAllowed: false,
        maxAgeMs: 60_000,
        catalogUrls: [CATALOG_URL],
      },
      port,
    )
    expect(miss.rows).toEqual([])
    expect(miss.unavailable).toEqual([{ catalogUrl: CATALOG_URL, reason: 'networkOff' }])
    expect(contacts).toBe(1)
  })
  it('never stores an invalid catalog', async () => {
    setUiText(EN, BASE_LOCALE)
    let stores = 0
    const port: EstimatePricePort = {
      cached: () => Promise.resolve('not json'),
      store: () => {
        stores += 1
        return Promise.resolve()
      },
      fetchPublic: () => Promise.reject(new Error('network must stay off')),
    }
    const result = await lookupEstimatePrices(
      {
        asOf: AS_OF,
        enabled: true,
        networkAllowed: false,
        maxAgeMs: 60_000,
        catalogUrls: [CATALOG_URL],
      },
      port,
    )
    expect(result).toEqual({
      rows: [],
      sources: [],
      unavailable: [{ catalogUrl: CATALOG_URL, reason: 'invalidCatalog' }],
    })
    expect(stores).toBe(0)
  })
  it('leaves the refusing catalog binding’s wait alone', async () => {
    setUiText(EN, BASE_LOCALE)
    const ports = estimatePricePorts()
    await expect(
      lookupEstimatePrices(
        {
          asOf: AS_OF,
          enabled: true,
          networkAllowed: false,
          maxAgeMs: 60_000,
          catalogUrls: [CATALOG_URL],
        },
        ports,
      ),
    ).rejects.toThrow('M117-W-M113-catalog')
  })
})
