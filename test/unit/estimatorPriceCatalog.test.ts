// M117 C-M117-4R2: the estimator's dated price catalogs. Azure's retail
// prices API needs no account; the adapter is written from the captured
// response at test/fixtures/estimator/azure-retail-eastus.json (fetched
// 2026-10-11: 5,686 bytes, no ETag, `cache-control: no-cache`), plus the
// lead's captures of the same public endpoint (one-SKU with Spot rows,
// paged with NextPageLink). The port reads through the report network
// reader's own transport and cache. Repository default timeout; no skips.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  estimateCatalogAdapters,
  ESTIMATE_AZURE_RETAIL_METERS,
  parseAzureRetailCatalog,
} from '../../src/core/estimator/priceCatalogs'
import { lookupEstimatePrices, type EstimatePriceLookup } from '../../src/core/estimator/prices'
import {
  createPriceCatalogPort,
  type PriceCatalogSourceDeps,
} from '../../src/host/estimator/priceCatalogSource'
import type { ReportNetworkTransport } from '../../src/core/reporting/sources/cache'
import type { Logger } from '../../src/host/logger'
import { ESTIMATE_PRICE_CATALOG_URLS, ESTIMATE_PRICE_MAX_AGE_MS } from '../../src/shared/constants'
import {
  estimatorNetworkPolicy,
  lazyPriceCatalog,
} from '../../src/host/estimator/priceCatalogBundle'
import { createEstimatorRun } from '../../src/host/estimator/estimatorEntry'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, fill, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { recordingTransport } from './helpers/reportKindNetwork'
import { buildPlanSnapshot } from '../../src/core/estimator/planSnapshot'
import { fleetSnapshotSchema, parseEstimateGoal } from '../../src/shared/estimate'
import { fleetMachine, schedulePool } from './helpers/estimatorKindScheduleFixtures'

const CATALOG = ESTIMATE_PRICE_CATALOG_URLS[0]!
// A real fetch returns the WHATWG serialization (`%27` where the pinned URL
// has `'`); the port must accept it (P1, RVCM1174).
const NORMALIZED_CATALOG = new URL(CATALOG).href
const CAPTURE = JSON.parse(
  readFileSync(new URL('../fixtures/estimator/azure-retail-eastus.json', import.meta.url), 'utf8'),
) as unknown
const ONE_SKU = JSON.parse(
  readFileSync(
    new URL(
      '../fixtures/estimator/azure-retail-prices-one-sku/response.body.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as unknown
const PAGED = JSON.parse(
  readFileSync(
    new URL('../fixtures/estimator/azure-retail-prices-paged/response.body.json', import.meta.url),
    'utf8',
  ),
) as unknown
const AS_OF = '2026-10-06T12:00:00.000Z'
const STALE_AS_OF = new Date(Date.parse(AS_OF) + ESTIMATE_PRICE_MAX_AGE_MS + 1).toISOString()
const catalogDate = '2025-10-01'
const RENTAL_PLAN = `## 6. Milestones

### M117 — Capacity work (2026-10-06)

**Status 2026-10-06: building.**

- **Goal.** Ship capacity.
- **Depends on.** Nothing new.
- **Gates.** The full gate.

| Lane | Items | Files it owns | Starts | Hours |
| ---- | ----- | ------------- | ------ | ----- |
| 0 | all | \`src/a.ts\` | First | 8 |
`
/** A board that must never be contacted: any call fails the test loudly. */
const untouchedBoard = {
  audit: (): Promise<never> => Promise.reject(new Error('board untouched while pricing a rental')),
  start: (): Promise<never> => Promise.reject(new Error('board untouched while pricing a rental')),
}
const armBuilderDate = '2024-10-01'
const priceFor = (classId: string, hourlyUsd: number, sizeId: string, rowDate: string) => ({
  classId,
  price: {
    providerId: 'azure',
    sizeId,
    hourlyUsd,
    catalogUrl: CATALOG,
    catalogDate: rowDate,
    publicCatalog: true as const,
  },
})
const expectedRows = () => [
  priceFor('linux-arm64-builder', 0.312, 'Standard_D8plds_v6', armBuilderDate),
  priceFor('linux-x64-builder', 0.338, 'Standard_F8s_v2', catalogDate),
  priceFor('linux-x64-small', 0.0846, 'Standard_F2s_v2', catalogDate),
  priceFor('windows-x64-builder', 0.708, 'Standard_F8s_v2-windows', catalogDate),
]
const capturedItems = () => (structuredClone(CAPTURE) as { Items: Record<string, unknown>[] }).Items
const linuxBuilder = () =>
  capturedItems().find((item) => item['meterId'] === 'd333352f-7de8-4929-b0ca-47cb99975b75')!
const pinnedIds = new Set(ESTIMATE_AZURE_RETAIL_METERS.map((meter) => meter.meterId))
const priceResponse = (text: string, status: number, headers: Record<string, string> = {}) => {
  const created = new Response(text, { status, headers })
  // A real fetch answers with the normalised URL; only a redirect changes it.
  Object.defineProperty(created, 'url', { value: NORMALIZED_CATALOG, configurable: true })
  return created
}
const options = (overrides: Partial<EstimatePriceLookup> = {}): EstimatePriceLookup => ({
  asOf: AS_OF,
  enabled: true,
  networkAllowed: true,
  maxAgeMs: ESTIMATE_PRICE_MAX_AGE_MS,
  catalogUrls: [CATALOG],
  ...overrides,
})
const policy: PriceCatalogSourceDeps['policy'] = {
  surface: 'editor',
  mode: 'always',
  githubSignedIn: false,
  allowEgress: () => Promise.resolve(true),
}
function port(
  root: string,
  get: ReportNetworkTransport,
  adapters = estimateCatalogAdapters(),
  livePolicy = policy,
): ReturnType<typeof createPriceCatalogPort> {
  return createPriceCatalogPort({
    storageRoot: root,
    workspaceRoot: root,
    policy: livePolicy,
    transport: get,
    adapters,
    now: () => AS_OF,
  })
}
function transport(text: string = JSON.stringify(CAPTURE), status = 200) {
  return recordingTransport(() => Promise.resolve(priceResponse(text, status)))
}
const roots: string[] = []
async function storageRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'estimate-prices-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true })
  setUiText(EN, BASE_LOCALE)
})
describe('M117 captured Azure retail catalog', () => {
  it('maps the captured meters to dated hourly rows', () => {
    expect(parseAzureRetailCatalog(CAPTURE, { catalogUrl: CATALOG })).toEqual({
      catalogDate,
      rows: expectedRows(),
    })
  })
  it('dates each row by its own meter, not the page maximum', () => {
    const parsed = parseAzureRetailCatalog(CAPTURE, { catalogUrl: CATALOG })
    expect(
      parsed.rows.find((row) => row.classId === 'linux-arm64-builder')?.price.catalogDate,
    ).toBe(armBuilderDate)
    expect(parsed.rows.find((row) => row.classId === 'linux-x64-small')?.price.catalogDate).toBe(
      catalogDate,
    )
    expect(parsed.catalogDate).toBe(catalogDate)
  })
  it('ignores later unpriced rows when dating prices', () => {
    // The lead's one-SKU capture (byte-exact): Spot rows dated 2026-07-01
    // beside on-demand rows dated 2025-10-01. Only the two pinned on-demand
    // meters price, both at their own 2025-10-01.
    const parsed = parseAzureRetailCatalog(ONE_SKU, { catalogUrl: CATALOG })
    expect(parsed).toEqual({
      catalogDate,
      rows: [
        priceFor('linux-x64-builder', 0.338, 'Standard_F8s_v2', catalogDate),
        priceFor('windows-x64-builder', 0.708, 'Standard_F8s_v2-windows', catalogDate),
      ],
    })
  })
  it('refuses a paged answer instead of pricing one page as complete', () => {
    // The lead's paged capture (byte-exact): Count 1000 with a NextPageLink
    // carrying $skip=1000.
    expect(() => parseAzureRetailCatalog(PAGED, { catalogUrl: CATALOG })).toThrow()
    // A page that carries pinned meters still refuses: the set link alone is
    // the reason, using the lead's captured link value.
    const page = {
      ...(structuredClone(CAPTURE) as Record<string, unknown>),
      NextPageLink: (PAGED as { NextPageLink: string }).NextPageLink,
    }
    expect(page.NextPageLink).toContain('$skip=1000')
    expect(() => parseAzureRetailCatalog(page, { catalogUrl: CATALOG })).toThrow()
  })
  it('documents the default HTTPS port normalization and the actual pagination guard', () => {
    const link = z.object({ NextPageLink: z.string() }).parse(PAGED).NextPageLink
    expect(link).toContain(':443/')
    expect(new URL(link).port).toBe('')
    const record = readFileSync(
      new URL('../../docs/certification/m117-price-catalogs.md', import.meta.url),
      'utf8',
    )
    expect(record).toContain('WHATWG normalizes the default HTTPS port')
    expect(record).not.toContain('The `:443` link would also fail')
    expect(() =>
      parseAzureRetailCatalog(
        {
          ...z.record(z.string(), z.unknown()).parse(CAPTURE),
          NextPageLink: link,
        },
        { catalogUrl: CATALOG },
      ),
    ).toThrow('catalog-paged')
  })
  it('refuses an answer with none of the pinned meters', () => {
    const body = structuredClone(CAPTURE) as { Items: Record<string, unknown>[] }
    body.Items = body.Items.filter((item) => !pinnedIds.has(item['meterId'] as string))
    expect(body.Items.length).toBeGreaterThan(0)
    expect(() => parseAzureRetailCatalog(body, { catalogUrl: CATALOG })).toThrow()
  })
  it('pins four meters whose classes exist and whose size ids are unique', () => {
    expect(ESTIMATE_AZURE_RETAIL_METERS).toHaveLength(4)
    expect(new Set(ESTIMATE_AZURE_RETAIL_METERS.map((meter) => meter.meterId)).size).toBe(4)
    expect(new Set(ESTIMATE_AZURE_RETAIL_METERS.map((meter) => meter.sizeId)).size).toBe(4)
    expect(estimateCatalogAdapters().get(CATALOG)).toBe(parseAzureRetailCatalog)
  })
  it('skips spot, reservation, DevTest and non-USD rows without refusing the catalog', () => {
    const body = structuredClone(CAPTURE) as { Items: Record<string, unknown>[] }
    body.Items.push(
      { ...body.Items[0], meterId: '00000000-0000-4000-8000-000000000000' },
      { ...linuxBuilder(), currencyCode: 'EUR' },
    )
    expect(parseAzureRetailCatalog(body, { catalogUrl: CATALOG }).rows).toEqual(expectedRows())
  })
  it.each([
    ['missing items', { BillingCurrency: 'USD' }],
    ['empty items', { BillingCurrency: 'USD', Items: [] }],
    [
      'string price',
      { BillingCurrency: 'USD', Items: [{ ...linuxBuilder(), retailPrice: '0.338' }] },
    ],
    ['negative price', { BillingCurrency: 'USD', Items: [{ ...linuxBuilder(), retailPrice: -1 }] }],
  ])('refuses %s before any price shows', (_name, body) => {
    expect(() => parseAzureRetailCatalog(body, { catalogUrl: CATALOG })).toThrow()
  })
})
describe('M117 price port on the network cache', () => {
  it('accepts the percent-encoded URL a real fetch returns', async () => {
    // The pinned URL carries literal quotes; its WHATWG form carries %27.
    expect(NORMALIZED_CATALOG).not.toBe(CATALOG)
    const root = await storageRoot()
    const fake = transport()
    const result = await lookupEstimatePrices(options(), port(root, fake.transport))
    expect(result.rows).toEqual(expectedRows())
    expect(result.unavailable).toEqual([])
    expect(fake.calls).toHaveLength(1)
  })
  it('fetches a pinned catalog once, then serves the dated cache offline', async () => {
    const root = await storageRoot()
    const fake = transport()
    const pricePort = port(root, fake.transport)
    const networked = await lookupEstimatePrices(options(), pricePort)
    expect(networked.rows).toEqual(expectedRows())
    expect(networked.sources).toEqual([
      {
        catalogUrl: CATALOG,
        catalogDate,
        retrievedAt: AS_OF,
        freshness: 'fresh',
        via: 'network',
      },
    ])
    expect(networked.unavailable).toEqual([])
    expect(fake.calls).toHaveLength(1)
    const { request, etag } = fake.calls[0]!
    expect(request).toMatchObject({ url: CATALOG })
    expect(etag).toBeNull()
    // The projection lands in the shared report cache beside the reader's own
    // entry; the stored rows keep their own meter dates.
    const stored = JSON.parse(
      await readFile(path.join(root, 'reports', 'v1', 'cache', 'index.json'), 'utf8'),
    ) as { data: unknown }[]
    expect(stored.map((entry) => entry.data)).toContainEqual({ catalogDate, rows: expectedRows() })
    const offline = await lookupEstimatePrices(
      { ...options(), networkAllowed: false, asOf: '2026-10-07T12:00:00.000Z' },
      pricePort,
    )
    expect(offline.rows).toEqual(expectedRows())
    expect(offline.sources[0]).toMatchObject({ catalogDate, via: 'cache', freshness: 'fresh' })
    expect(fake.calls).toHaveLength(1)
  })
  it('revalidates with the cached ETag and stores the fresh retrieval', async () => {
    const root = await storageRoot()
    const seen: (string | null)[] = []
    const notModified = new Response(null, { status: 304 })
    Object.defineProperty(notModified, 'url', { value: NORMALIZED_CATALOG, configurable: true })
    const get: ReportNetworkTransport = (_request, etag) => {
      seen.push(etag)
      return Promise.resolve(
        etag === null
          ? priceResponse(JSON.stringify(CAPTURE), 200, { etag: '"capture-v1"' })
          : notModified,
      )
    }
    await lookupEstimatePrices(options(), port(root, get))
    expect(seen).toEqual([null])
    const result = await lookupEstimatePrices(options({ asOf: STALE_AS_OF }), port(root, get))
    expect(seen).toEqual([null, '"capture-v1"'])
    expect(result.rows).toEqual(expectedRows())
    expect(result.sources[0]).toMatchObject({
      catalogDate,
      retrievedAt: STALE_AS_OF,
      via: 'network',
    })
  })
  it('a failed refresh never overwrites the stale price cache used by the next lookup', async () => {
    const root = await storageRoot()
    const seededPort = port(root, transport().transport)
    await lookupEstimatePrices(options(), seededPort)
    const before = JSON.stringify(await seededPort.cached(CATALOG))
    const offlineTransport = recordingTransport(() => Promise.reject(new Error('offline')))
    const failedPort = port(root, offlineTransport.transport)
    const staleOptions = options({ asOf: STALE_AS_OF })
    const failed = await lookupEstimatePrices(staleOptions, failedPort)
    expect(offlineTransport.calls).toHaveLength(1)
    expect(failed.rows).toEqual(expectedRows())
    expect(failed.sources[0]).toMatchObject({
      retrievedAt: AS_OF,
      freshness: 'stale',
      via: 'cache',
    })
    expect(failed.unavailable).toEqual([{ catalogUrl: CATALOG, reason: 'unavailable' }])
    expect(JSON.stringify(await failedPort.cached(CATALOG))).toBe(before)
    const offline = await lookupEstimatePrices(
      { ...staleOptions, networkAllowed: false },
      failedPort,
    )
    expect(offline.rows).toEqual(expectedRows())
    expect(offline.sources[0]).toMatchObject({
      retrievedAt: AS_OF,
      freshness: 'stale',
      via: 'cache',
    })
    expect(offlineTransport.calls).toHaveLength(1)
  })
  it.each(['workspace trust', 'sandbox network', 'Reports network', 'sign-in', 'sign-in mode'])(
    'withdraws %s between cache read and request without sending a price request',
    async (permission) => {
      const root = await storageRoot()
      const settings = {
        'reports.network': 'whenSignedIn' as const,
        sandboxNetwork: 'enabled' as const,
      }
      // Mutable settings are injected through the same policy factory activation uses.
      let mode: 'whenSignedIn' | 'always' | 'off' =
        permission === 'sign-in mode' ? 'always' : settings['reports.network']
      let sandboxNetwork: 'enabled' | 'restricted' = settings.sandboxNetwork
      let isTrusted = true
      let isSignedIn = permission !== 'sign-in mode'
      const livePolicy = estimatorNetworkPolicy({
        settings: () => ({ 'reports.network': mode, sandboxNetwork }),
        isTrusted: () => isTrusted,
        isSignedIn: () => isSignedIn,
      })
      const fake = transport()
      const pricePort = port(root, fake.transport, estimateCatalogAdapters(), livePolicy)
      const admitted = options({ networkAllowed: livePolicy.mode !== 'off' })
      expect(admitted.networkAllowed).toBe(true)
      const cached = pricePort.cached.bind(pricePort)
      pricePort.cached = async (catalogUrl) => {
        const result = await cached(catalogUrl)
        switch (permission) {
          case 'workspace trust': {
            isTrusted = false
            break
          }
          case 'sandbox network': {
            sandboxNetwork = 'restricted'
            break
          }
          case 'Reports network': {
            mode = 'off'
            break
          }
          case 'sign-in': {
            isSignedIn = false
            break
          }
          case 'sign-in mode': {
            mode = 'whenSignedIn'
            break
          }
          default: {
            throw new Error('Unknown permission withdrawal')
          }
        }
        return result
      }
      const result = await lookupEstimatePrices(admitted, pricePort)
      expect(fake.calls).toHaveLength(0)
      expect(result.rows).toEqual([])
      expect(result.unavailable).toEqual([{ catalogUrl: CATALOG, reason: 'unavailable' }])
    },
  )
  it('rechecks the same egress function at the price socket after the reader cache', async () => {
    const root = await storageRoot()
    const fake = transport()
    let egressCalls = 0
    const allowEgress: PriceCatalogSourceDeps['policy']['allowEgress'] = () => {
      egressCalls += 1
      return Promise.resolve(egressCalls === 1)
    }
    const result = await lookupEstimatePrices(
      options(),
      port(root, fake.transport, estimateCatalogAdapters(), { ...policy, allowEgress }),
    )
    expect(fake.calls).toHaveLength(0)
    expect(egressCalls).toBe(2)
    expect(result.unavailable).toEqual([{ catalogUrl: CATALOG, reason: 'unavailable' }])
  })
  it('never fetches an unpinned catalog URL', async () => {
    const root = await storageRoot()
    const fake = transport()
    const pricePort = port(root, fake.transport)
    await expect(
      pricePort.fetchPublic('https://catalog.invalid/other', undefined),
    ).rejects.toThrow()
    expect(fake.calls).toHaveLength(0)
  })
  it('refuses a redirect to another host before parsing', async () => {
    const root = await storageRoot()
    const moved = priceResponse(JSON.stringify(CAPTURE), 200)
    Object.defineProperty(moved, 'url', { value: 'https://catalog.invalid/elsewhere' })
    const fake: ReportNetworkTransport = () => Promise.resolve(moved)
    const result = await lookupEstimatePrices(options(), port(root, fake))
    expect(result.rows).toEqual([])
    expect(result.unavailable).toEqual([{ catalogUrl: CATALOG, reason: 'unavailable' }])
  })
  it.each([
    ['http error', 500, JSON.stringify(CAPTURE)],
    ['invalid json', 200, 'not json'],
    ['drifted shape', 200, JSON.stringify({ BillingCurrency: 'USD', Items: [] })],
    ['paged answer', 200, JSON.stringify(PAGED)],
    ['oversize body', 200, `{"BillingCurrency":"USD","Items":[${' '.repeat(300 * 1024)}]}`],
  ])('retains the stored catalog when the refresh is %s', async (_name, status, text) => {
    const root = await storageRoot()
    const seeded = await lookupEstimatePrices(options(), port(root, transport().transport))
    expect(seeded.rows).toEqual(expectedRows())
    const before = await port(root, transport().transport).cached(CATALOG)
    const failedTransport = transport(text, status)
    const failing = port(root, failedTransport.transport)
    const result = await lookupEstimatePrices(options({ asOf: STALE_AS_OF }), failing)
    expect(failedTransport.calls).toHaveLength(1)
    expect(result.rows).toEqual(expectedRows())
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]).toMatchObject({
      catalogDate,
      retrievedAt: AS_OF,
      via: 'cache',
      freshness: 'stale',
    })
    // The failed refresh is still reported; the rows come from the kept entry.
    expect(result.unavailable).toEqual([{ catalogUrl: CATALOG, reason: 'unavailable' }])
    // A failed refresh never overwrites the validated entry.
    expect(await failing.cached(CATALOG)).toEqual(before)
  })
})
describe('M117 dated prices in the estimate', () => {
  it('prices a rented setup from a fresh cache while the network stays off', async () => {
    setUiText(EN, BASE_LOCALE)
    const goal = parseEstimateGoal('M117')
    if (goal === undefined) throw new Error('unparseable goal: M117')
    const snapshot = buildPlanSnapshot(RENTAL_PLAN, goal, AS_OF, { branches: [] })
    const laneKind = snapshot.lanes[0]?.lane.kind
    if (laneKind === undefined) throw new Error('plan snapshot has no lanes')
    // The role and the machines admit the snapshot lane's own kind: the
    // pool is a pricing fixture, not a policy statement about the lane.
    const base = schedulePool(laneKind, 2)
    const pool = fleetSnapshotSchema.parse({
      ...base,
      machines: [
        ...base.machines,
        {
          ...fleetMachine('rental-0', 'linux-x64-small', 1),
          id: 'rental-0',
          source: 'rented',
          // The rented offer must match its class exactly (M117 C-M117-4):
          // linux-x64-small is 2 vCPU and 4 GiB.
          cores: 2,
          ramGiB: 4,
          capacityByKind: [{ kind: laneKind, slots: 1 }],
        },
      ],
      slots: [
        ...base.slots,
        {
          id: 'rental-0-slot',
          machineId: 'rental-0',
          roleId: 'schedule-role',
          accountId: 'schedule-account',
        },
      ],
    })
    const document = {
      retrievedAt: AS_OF,
      catalogDate,
      etag: '"capture-v1"',
      rows: expectedRows(),
    }
    let fetches = 0
    const source = {
      snapshot: () => Promise.resolve(snapshot),
      fleet: () => Promise.resolve(pool),
      history: () => Promise.resolve([]),
      candidatePool: () => Promise.resolve(pool),
      board: () => untouchedBoard,
      prices: () => ({
        cached: () => Promise.resolve(structuredClone(document)),
        store: () => Promise.resolve(),
        fetchPublic: () => {
          fetches += 1
          return Promise.reject(new Error('network must stay off'))
        },
      }),
      priceLookup: () => ({
        enabled: true,
        networkAllowed: false,
        maxAgeMs: ESTIMATE_PRICE_MAX_AGE_MS,
        catalogUrls: [CATALOG],
      }),
    }
    const section = await createEstimatorRun(source, EN, BASE_LOCALE).estimate(
      {
        goal,
        asOf: AS_OF,
        fleet: 'optimum',
        optimize: 'speed',
        seed: 'prices',
      },
      new AbortController().signal,
    )
    const fastest = section.setups.find((setup) => setup.kind === 'optimumSpeed')!
    const rented = fastest.machines.find((machine) => machine.classId === 'linux-x64-small')!
    expect(rented.price).toEqual({ ...expectedRows()[2]!.price })
    expect(fetches).toBe(0)
  })
})
describe('M117 bounded public transport', () => {
  it('sends the ETag and reads the answer within bounds', async () => {
    const root = await storageRoot()
    const seen: { url: string; etag: string | null }[] = []
    const get: ReportNetworkTransport = (request, etag) => {
      seen.push({ url: request.url, etag })
      return Promise.resolve(priceResponse(JSON.stringify(CAPTURE), 200))
    }
    const pricePort = port(root, get)
    const modified = await pricePort.fetchPublic(CATALOG, '"v1"')
    // The reader owns revalidation from its own entries: the caller's hint is
    // accepted but the conditional GET rides the shared cache, so the first
    // fetch goes out without an ETag.
    expect(seen).toEqual([{ url: CATALOG, etag: null }])
    expect(modified).toMatchObject({ status: 'modified', catalogDate })
  })
  it('refuses redirects and oversize answers before parsing', async () => {
    const root = await storageRoot()
    const moved = priceResponse('', 200)
    Object.defineProperty(moved, 'url', { value: 'https://catalog.invalid/elsewhere' })
    await expect(
      port(root, () => Promise.resolve(moved)).fetchPublic(CATALOG, undefined),
    ).rejects.toThrow()
    const big = priceResponse('x'.repeat(300 * 1024), 200, {
      'content-length': String(300 * 1024),
    })
    await expect(
      port(root, () => Promise.resolve(big)).fetchPublic(CATALOG, undefined),
    ).rejects.toThrow()
  })
})

describe('price catalog loader fallback', () => {
  it('refuses a corrupt bundle with the installed failure sentence', () => {
    setUiText(EN, BASE_LOCALE)
    const log: Logger = {
      trace: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }
    const loader = lazyPriceCatalog({ bundlePath: 'missing.js', log, loadBundle: () => ({}) })
    const policy = estimatorNetworkPolicy({
      settings: () => ({ 'reports.network': 'off' as const, sandboxNetwork: 'enabled' as const }),
      isTrusted: () => true,
      isSignedIn: () => false,
    })
    expect(() =>
      loader.createEstimatePricePort({ storageRoot: '', workspaceRoot: '', policy }),
    ).toThrow(fill(UI_TEXT.estimateFailed, { detail: 'price-catalog-bundle-unavailable' }))
  })
})
