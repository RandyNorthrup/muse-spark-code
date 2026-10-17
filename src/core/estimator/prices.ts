import * as z from 'zod/mini'
import {
  estimateRequestSchema,
  estimateSectionSchema,
  machineClassesSchema,
  machineClassSchema,
  type CatalogPrice,
} from '../../shared/estimate'
import machineClasses from '../../shared/machineClasses.json'
import { ESTIMATE_MAX_ITEMS } from '../../shared/constants'
import { fill, UI_TEXT } from '../../shared/l10n/text'
import { compareEstimateIds } from './goal'

const priceSchema =
  estimateSectionSchema.shape.setups.def.element.shape.machines.def.element.shape.price.def
    .innerType
const rowSchema = z.strictObject({ classId: machineClassSchema.shape.id, price: priceSchema })
const rowsSchema = z.array(rowSchema).check(
  z.maxLength(ESTIMATE_MAX_ITEMS),
  z.refine(
    (rows) =>
      new Set(rows.map((row) => JSON.stringify([row.price.providerId, row.price.sizeId]))).size ===
      rows.length,
  ),
)
const documentSchema = z.strictObject({
  retrievedAt: estimateRequestSchema.shape.asOf,
  catalogDate: z.iso.date(),
  etag: z.optional(z.string().check(z.minLength(1))),
  rows: rowsSchema,
})
const responseSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('notModified') }),
  z.strictObject({
    status: z.literal('modified'),
    catalogDate: z.iso.date(),
    etag: z.optional(z.string().check(z.minLength(1))),
    rows: rowsSchema,
  }),
])
export interface EstimatePricePort {
  /** M113 N owns persistence and public-address/redirect-safe transport.
   * fetchPublic returns a parsed application projection from a captured
   * catalog adapter, never a provider's raw wire response or credentials.
   */
  cached(catalogUrl: string): Promise<unknown>
  store(catalogUrl: string, document: z.infer<typeof documentSchema>): Promise<void>
  fetchPublic(catalogUrl: string, etag?: string): Promise<unknown>
}
export interface EstimatePriceLookup {
  asOf: string
  enabled: boolean
  /** Resolved M113 setting AND terminal --network/egress floor. */
  networkAllowed: boolean
  maxAgeMs: number
  catalogUrls: readonly string[]
}
export interface EstimatePrices {
  rows: { classId: string; price: CatalogPrice }[]
  sources: {
    catalogUrl: string
    catalogDate: string
    retrievedAt: string
    freshness: 'fresh' | 'stale'
    via: 'cache' | 'network' | 'revalidated'
  }[]
  unavailable: {
    catalogUrl: string
    reason: 'networkOff' | 'unavailable' | 'invalidCatalog' | 'emptyCatalog'
  }[]
}

function refuse(detail: string): never {
  throw new Error(fill(UI_TEXT.estimateFailed, { detail }))
}
function isPublicUrl(text: string): boolean {
  try {
    const url = new URL(text)
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
  } catch {
    return false
  }
}
function isConsistent(
  document: z.infer<typeof documentSchema>,
  catalogUrl: string,
  asOf: string,
): boolean {
  const classes = machineClassesSchema.parse(machineClasses)
  return (
    Date.parse(document.retrievedAt) <= Date.parse(asOf) &&
    document.catalogDate <= document.retrievedAt.slice(0, 'YYYY-MM-DD'.length) &&
    document.rows.every(
      (row) =>
        classes.some((size) => size.id === row.classId) &&
        row.price.catalogUrl === catalogUrl &&
        isPublicUrl(row.price.catalogUrl) &&
        row.price.catalogDate === document.catalogDate,
    )
  )
}

/** Optional no-account catalogs. Dates come only from injected asOf and the
 * adapter's dated catalog evidence, never the clock or a guessed price.
 * Offline stale evidence is retained and labelled; a failed refresh cannot
 * overwrite a previously validated cache entry.
 */
export async function lookupEstimatePrices(
  options: EstimatePriceLookup,
  port: EstimatePricePort,
): Promise<EstimatePrices> {
  const asOf = estimateRequestSchema.shape.asOf.parse(options.asOf)
  if (
    !Number.isFinite(options.maxAgeMs) ||
    options.maxAgeMs < 0 ||
    options.catalogUrls.length > ESTIMATE_MAX_ITEMS ||
    new Set(options.catalogUrls).size !== options.catalogUrls.length ||
    options.catalogUrls.some((url) => !isPublicUrl(url))
  )
    refuse('catalog-options')
  const result: EstimatePrices = { rows: [], sources: [], unavailable: [] }
  if (!options.enabled) return result
  for (const catalogUrl of [...options.catalogUrls].toSorted(compareEstimateIds)) {
    let rawCache: unknown
    let wasCacheUnavailable = false
    try {
      rawCache = await port.cached(catalogUrl)
    } catch {
      wasCacheUnavailable = true
    }
    const parsed = documentSchema.safeParse(rawCache)
    let document =
      parsed.success && isConsistent(parsed.data, catalogUrl, asOf) ? parsed.data : undefined
    let via: EstimatePrices['sources'][number]['via'] = 'cache'
    let failure: EstimatePrices['unavailable'][number]['reason'] =
      rawCache === undefined ? 'networkOff' : 'invalidCatalog'
    if (wasCacheUnavailable) failure = 'unavailable'
    const isStale = () =>
      !document || Date.parse(asOf) - Date.parse(document.retrievedAt) > options.maxAgeMs
    if (options.networkAllowed && isStale()) {
      failure = 'unavailable'
      try {
        const response = responseSchema.safeParse(
          await port.fetchPublic(catalogUrl, document?.etag),
        )
        if (response.success) {
          const replacement =
            response.data.status === 'notModified'
              ? document && { ...document, retrievedAt: asOf }
              : {
                  retrievedAt: asOf,
                  catalogDate: response.data.catalogDate,
                  ...(response.data.etag && { etag: response.data.etag }),
                  rows: response.data.rows,
                }
          if (replacement && isConsistent(replacement, catalogUrl, asOf)) {
            await port.store(catalogUrl, structuredClone(replacement))
            document = replacement
            via = response.data.status === 'notModified' ? 'revalidated' : 'network'
          } else failure = 'invalidCatalog'
        } else {
          failure = 'invalidCatalog'
        }
      } catch {
        // Do not expose transport/cache error text (may contain account data).
        failure = 'unavailable'
      }
      if (via === 'cache') result.unavailable.push({ catalogUrl, reason: failure })
    }
    if (!document) {
      if (result.unavailable.every((entry) => entry.catalogUrl !== catalogUrl))
        result.unavailable.push({ catalogUrl, reason: failure })
      continue
    }
    if (document.rows.length === 0) result.unavailable.push({ catalogUrl, reason: 'emptyCatalog' })
    result.rows.push(
      ...document.rows.toSorted((a, b) =>
        compareEstimateIds(
          JSON.stringify([a.classId, a.price.providerId, a.price.sizeId]),
          JSON.stringify([b.classId, b.price.providerId, b.price.sizeId]),
        ),
      ),
    )
    result.sources.push({
      catalogUrl,
      catalogDate: document.catalogDate,
      retrievedAt: document.retrievedAt,
      freshness: isStale() ? 'stale' : 'fresh',
      via,
    })
  }
  return result
}
