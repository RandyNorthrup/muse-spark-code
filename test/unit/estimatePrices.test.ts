// The estimate price catalog lookup (D119): a missing cache entry is a cold
// cache the network refresh can rescue, while any other store failure keeps
// its kind for the caller instead of reading as merely unavailable.
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { lookupEstimatePrices, type EstimatePricePort } from '../../src/core/estimator/prices'
import { estimatorSourcePorts } from '../../src/host/estimator/localFleet'
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

  it('leaves the refusing catalog binding’s wait alone', async () => {
    setUiText(EN, BASE_LOCALE)
    const ports = estimatorSourcePorts(() => ({
      enabled: true,
      networkAllowed: false,
      maxAgeMs: 60_000,
      catalogUrls: [],
    })).prices()
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
