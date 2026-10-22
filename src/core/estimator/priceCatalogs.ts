import * as z from 'zod/mini'
import machineClasses from '../../shared/machineClasses.json'
import { machineClassesSchema, type CatalogPrice } from '../../shared/estimate'
import { compareEstimateIds } from './goal'
import { ESTIMATE_PRICE_CATALOG_URLS } from '../../shared/constants'
import { fill, UI_TEXT } from '../../shared/l10n/text'

// A captured public server-price catalog (M117 C-M117-4, PLAN.md D97.6):
// Azure's retail prices API needs no account and answers a filtered query in
// kilobytes. The adapter is written from the captured response at
// test/fixtures/estimator/azure-retail-eastus.json (fetched 2026-10-11, no
// ETag observed, `cache-control: no-cache`): top-level BillingCurrency,
// CustomerEntityId/CustomerEntityType, Items, NextPageLink and Count, with
// one object per meter. Only exact pinned meters become rows; anything the
// wire adds later (a new meter, a new field) is skipped, never priced.

// The wire fields the adapter reads. Unknown extra fields stay unread so a
// vendor addition cannot break the lookup; missing or mistyped required
// fields refuse the whole response.
const azureItemSchema = z.object({
  meterId: z.string().check(z.minLength(1)),
  meterName: z.string(),
  skuName: z.string(),
  productName: z.string(),
  retailPrice: z.number(),
  unitOfMeasure: z.string(),
  type: z.string(),
  currencyCode: z.string(),
  effectiveStartDate: z.iso.datetime({ offset: true }),
  armRegionName: z.string(),
  armSkuName: z.string(),
  serviceName: z.string(),
})
const azureResponseSchema = z.object({
  BillingCurrency: z.string(),
  Items: z.array(azureItemSchema),
  // The API pages large answers (the lead's `priceType eq 'Consumption'`
  // capture answers `Count: 1000` with a `NextPageLink` carrying `$skip=1000`).
  // A page is never priced as complete: a set link refuses the whole answer.
  NextPageLink: z.optional(z.nullable(z.string())),
})
export interface EstimateCatalogMeter {
  readonly meterId: string
  /** The provider's SKU both offers share; the row's sizeId makes it unique. */
  readonly armSkuName: string
  readonly classId: string
  readonly sizeId: string
}
// The estimate's machine class each pinned meter rents, from Azure's
// published VM sizes (F2s v2 2 vCPU/4 GiB, F8s v2 8/16, D8plds v6 8/16 ARM):
// the price is captured, the attribution is this table, pinned by meter id.
// Windows carries its license in the meter, so its size id differs from the
// Linux offer of the same SKU (prices.ts refuses duplicate provider/size
// pairs). macOS and GPU classes have no exact meter in this catalog and stay
// unpriced: no row without a captured meter.
export const ESTIMATE_AZURE_RETAIL_METERS: readonly EstimateCatalogMeter[] = [
  {
    meterId: '80f75331-285d-4a95-930b-185d314ee78a',
    armSkuName: 'Standard_F2s_v2',
    classId: 'linux-x64-small',
    sizeId: 'Standard_F2s_v2',
  },
  {
    meterId: 'd333352f-7de8-4929-b0ca-47cb99975b75',
    armSkuName: 'Standard_F8s_v2',
    classId: 'linux-x64-builder',
    sizeId: 'Standard_F8s_v2',
  },
  {
    meterId: '4262eb9d-4bb6-5f32-87f1-c982b04f0f59',
    armSkuName: 'Standard_D8plds_v6',
    classId: 'linux-arm64-builder',
    sizeId: 'Standard_D8plds_v6',
  },
  {
    meterId: 'f32bd919-c119-4152-9b2d-cb2034b336a7',
    armSkuName: 'Standard_F8s_v2',
    classId: 'windows-x64-builder',
    sizeId: 'Standard_F8s_v2-windows',
  },
]
export interface EstimateCatalogRows {
  readonly catalogDate: string
  readonly rows: { classId: string; price: CatalogPrice }[]
}
export type EstimateCatalogAdapter = (
  body: unknown,
  context: { catalogUrl: string },
) => EstimateCatalogRows
type CatalogRow = EstimateCatalogRows['rows'][number]
/** Code-unit order, so rows are deterministic no matter how the vendor orders
its answer; prices.ts re-sorts identically through this same comparator. */
export function compareCatalogRows(a: CatalogRow, b: CatalogRow): number {
  return compareEstimateIds(
    JSON.stringify([a.classId, a.price.providerId, a.price.sizeId]),
    JSON.stringify([b.classId, b.price.providerId, b.price.sizeId]),
  )
}
function refuse(detail: string): never {
  throw new Error(fill(UI_TEXT.estimateFailed, { detail }))
}
/** Azure's retail API carries per-meter start dates but no catalog version,
so each priced row carries its own meter's `effectiveStartDate`, and the
answer's catalog date is the latest of those priced rows only. Rows that
are not priced (another meter, spot, reservation, DevTest, non-USD) never
influence a date: the lead's one-SKU capture carries Spot rows dated
`2026-07-01` beside on-demand rows dated `2025-10-01`, and the on-demand
prices stay `2025-10-01`. An answer that carries none of the pinned meters
(or nothing at all) cannot date a price, so it refuses and no price shows.
Consumption hourly USD rows only. A set `NextPageLink` means the answer is
one page of several, so the whole answer refuses rather than pricing a
page as complete.
*/
export function parseAzureRetailCatalog(
  body: unknown,
  context: { catalogUrl: string },
): EstimateCatalogRows {
  const parsed = azureResponseSchema.safeParse(body)
  if (!parsed.success || parsed.data.Items.length === 0) refuse('invalid-catalog')
  if (typeof parsed.data.NextPageLink === 'string' && parsed.data.NextPageLink !== '')
    refuse('catalog-paged')
  const classes = new Set(machineClassesSchema.parse(machineClasses).map((size) => size.id))
  const rows: { classId: string; price: CatalogPrice }[] = []
  for (const item of parsed.data.Items) {
    const meter = ESTIMATE_AZURE_RETAIL_METERS.find((entry) => entry.meterId === item.meterId)
    if (
      meter === undefined ||
      item.type !== 'Consumption' ||
      item.unitOfMeasure !== '1 Hour' ||
      item.currencyCode !== 'USD'
    )
      continue
    if (!Number.isFinite(item.retailPrice) || item.retailPrice < 0 || !classes.has(meter.classId))
      refuse('invalid-catalog')
    const meterDate = item.effectiveStartDate.slice(0, 'YYYY-MM-DD'.length)
    z.iso.date().parse(meterDate)
    rows.push({
      classId: meter.classId,
      price: {
        providerId: 'azure',
        sizeId: meter.sizeId,
        hourlyUsd: item.retailPrice,
        catalogUrl: context.catalogUrl,
        catalogDate: meterDate,
        publicCatalog: true,
      },
    })
  }
  if (rows.length === 0) refuse('invalid-catalog')
  const catalogDate =
    rows
      .map((row) => row.price.catalogDate)
      .toSorted(compareEstimateIds)
      .at(-1) ?? refuse('invalid-catalog')
  rows.sort(compareCatalogRows)
  return { catalogDate, rows }
}
/** The pinned catalog URLs each adapter reads, in lookup order. */
export function estimateCatalogAdapters(): ReadonlyMap<string, EstimateCatalogAdapter> {
  return new Map(
    ESTIMATE_PRICE_CATALOG_URLS.map((catalogUrl) => [catalogUrl, parseAzureRetailCatalog]),
  )
}
